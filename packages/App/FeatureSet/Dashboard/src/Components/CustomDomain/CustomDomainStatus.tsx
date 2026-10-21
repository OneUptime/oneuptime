import {
  CUSTOM_DOMAIN_STATUS,
  CustomDomainState,
  CustomDomainStateInput,
  getCustomDomainCertificateError,
  getCustomDomainState,
  STATUS_TEST_IDS,
} from "./CustomDomainCopy";
import { CustomDomainCertificate } from "Common/Types/CustomDomain/CustomDomainCertificates";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A custom domain's Status cell, a status page's or a dashboard's: where the
 * domain is on its way to HTTPS, in one sentence, and - when an order
 * failed - why, in the words the order failed with, on a line of its own.
 */

export interface ComponentProps {
  domain: CustomDomainStateInput;
  // The domain's certificate, when the page has it.
  certificate?: CustomDomainCertificate | undefined;
}

const CustomDomainStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const state: CustomDomainState = getCustomDomainState(
    props.domain,
    props.certificate,
  );

  const certificateError: string | undefined = getCustomDomainCertificateError(
    state,
    props.certificate,
  );

  return (
    <span className="block" data-testid={STATUS_TEST_IDS.status}>
      <span>{translator.translateText(CUSTOM_DOMAIN_STATUS[state])}</span>
      {certificateError ? (
        <span
          className="mt-1 block break-words text-xs text-gray-500"
          data-testid={STATUS_TEST_IDS.certificateError}
        >
          {certificateError}
        </span>
      ) : (
        <></>
      )}
    </span>
  );
};

export default CustomDomainStatus;
