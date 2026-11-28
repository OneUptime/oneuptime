import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { StorageArrayPresentedCertificate } from "Common/Types/StorageArray/Collection/StorageArrayProbeCollection";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The certificate a storage management server presented when the probe
 * did not trust it (#11004): who it was issued to and by, until when, and
 * its SHA-256 fingerprint, with "Trust this certificate" - VMware's
 * CertificateDetails, with the platform's own words for how to check the
 * fingerprint first.
 */

export interface ComponentProps {
  certificate: StorageArrayPresentedCertificate;
  // How to check the fingerprint against the server's own (a translation key).
  checkHint: string;
  onTrust?: (() => void) | undefined;
}

const StorageArrayCertificateDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const rows: Array<{ label: string; value: string }> = [
    {
      label: translator.translateText("Issued to") as string,
      value: props.certificate.subject,
    },
    {
      label: translator.translateText("Issued by") as string,
      value: props.certificate.issuer,
    },
  ];

  if (props.certificate.validTo) {
    rows.push({
      label: translator.translateText("Valid until") as string,
      value: OneUptimeDate.getDateAsLocalFormattedString(
        new Date(props.certificate.validTo),
        true,
      ),
    });
  }

  return (
    <div
      className="mt-3 rounded-md border border-gray-200 bg-white p-3"
      data-testid="storage-array-presented-certificate"
    >
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {rows.map((row: { label: string; value: string }) => {
          return (
            <div key={row.label} className="sm:col-span-1">
              <dt className="text-gray-500">{row.label}</dt>
              <dd className="break-words text-gray-900">{row.value}</dd>
            </div>
          );
        })}
      </dl>
      <div className="mt-2 text-xs">
        <div className="text-gray-500">
          {translator.translateText("SHA-256 fingerprint")}
        </div>
        <code
          className="block break-all font-mono text-gray-900"
          data-testid="storage-array-presented-fingerprint"
        >
          {props.certificate.fingerprint256}
        </code>
      </div>
      {props.onTrust ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            title="Trust this certificate"
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            icon={IconProp.ShieldCheck}
            dataTestId="storage-array-trust-certificate-button"
            onClick={props.onTrust}
          />
          <span className="text-xs text-gray-500">
            {translator.translateText(props.checkHint)}
          </span>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default StorageArrayCertificateDetails;
