import {
  CustomDomainInstallation,
  CustomDomainState,
  CustomDomainStateInput,
  getCustomDomainState,
} from "./CustomDomainCopy";
import { getCustomDomainInstallation } from "./CustomDomainKinds";
import PublicAddressCopy, {
  getCustomDomainUrl,
  isCustomDomainLive,
} from "./PublicAddressCopy";
import { CustomDomainCertificate } from "Common/Types/CustomDomain/CustomDomainCertificates";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A custom domain's Domain cell, a status page's or a dashboard's: once it
 * is live - visitors can open it over HTTPS - a link to it that opens in a
 * new tab, as the page's own list of addresses draws it (PublicAddresses);
 * until then its name alone, as there is nothing to open yet (its Status
 * says why). It used to be the name alone, live or not.
 */

export interface ComponentProps {
  domain: CustomDomainStateInput & { fullDomain?: string | undefined };
  // The domain's certificate, when the page has it.
  certificate?: CustomDomainCertificate | undefined;
}

export const CUSTOM_DOMAIN_NAME_TEST_IDS: { name: string; link: string } = {
  name: "custom-domain-name",
  link: "custom-domain-name-link",
};

const CustomDomainName: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const fullDomain: string = (props.domain.fullDomain || "").trim();

  const installation: CustomDomainInstallation = getCustomDomainInstallation();
  const state: CustomDomainState = getCustomDomainState(
    props.domain,
    props.certificate,
    undefined,
    installation,
  );

  const isLive: boolean = Boolean(fullDomain) && isCustomDomainLive(state);

  if (!isLive) {
    return (
      <span
        className="break-all"
        data-testid={CUSTOM_DOMAIN_NAME_TEST_IDS.name}
      >
        {fullDomain}
      </span>
    );
  }

  /*
   * A plain anchor: the domain is opened as stored, never parsed into a
   * URL, which refuses some names (a label past DNS's 63 characters).
   *
   * The table's cell clips what is drawn past its sides, a focus ring's
   * left edge included, so the keyboard's focus is a heavy underline under
   * the name instead - drawn inside the cell, where hover draws its own.
   */
  return (
    <a
      href={getCustomDomainUrl(fullDomain, state, installation)}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex max-w-full items-center gap-1 break-all text-gray-900 hover:text-indigo-600 hover:underline focus:outline-none focus-visible:underline focus-visible:decoration-2 focus-visible:underline-offset-4"
      data-testid={CUSTOM_DOMAIN_NAME_TEST_IDS.link}
    >
      <span>{fullDomain}</span>
      <Icon
        icon={IconProp.ExternalLink}
        className="h-3.5 w-3.5 flex-none text-gray-400 group-hover:text-indigo-600"
      />
      <span className="sr-only">
        {" "}
        {translator.translateText(PublicAddressCopy.opensInNewTab)}
      </span>
    </a>
  );
};

export default CustomDomainName;
