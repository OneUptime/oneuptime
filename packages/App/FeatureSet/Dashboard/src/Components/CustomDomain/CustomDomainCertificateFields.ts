import { CustomDomainModel } from "./CustomDomainKinds";
import {
  isUploadedCertificateRefusal,
  isUploadedKeyRefusal,
} from "Common/Types/CustomDomain/UploadedCertificateRefusals";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

/*
 * THE CERTIFICATE OPTIONS OF A CUSTOM DOMAIN'S EDIT DIALOG.
 *
 * Editing a status page's, a dashboard's or a form's custom domain can
 * change only its certificate (the name is fixed once the domain is added),
 * so these are the dialog: Upload Custom Certificate, then the certificate
 * and its private key while it is on (CustomDomainsTable).
 *
 * The private key is write-only: nobody reads it back once it is saved, so
 * the dialog never loads it (ModelForm's write-only fields). What it asks
 * depends on whether a key is stored, read from the domain as the dialog
 * opened it (Field.hasNothingStoredWhenEditing):
 *
 *   - a domain that serves its own certificate keeps its key: the field is
 *     empty, optional, and says that blank keeps the stored one, so a
 *     renewed certificate is pasted alone;
 *   - a domain on the free certificate has no key: switching Upload Custom
 *     Certificate on asks for one, required, with why it is needed and that
 *     it is never shown again. It used to say "Leave blank to keep the
 *     stored value." with nothing stored, and a save without a key was
 *     refused over the form.
 *
 * A save the server refuses because of the pair (Types/CustomDomain/
 * UploadedCertificateRefusals) says why under the half it is about, in the
 * reader's language: a key that does not belong to the certificate under
 * Certificate Private Key, a certificate that cannot be read under
 * Certificate.
 */

// Whether Upload Custom Certificate is on, as the form holds it now.
const servesOwnCertificate: (
  values: FormValues<CustomDomainModel>,
) => boolean = (values: FormValues<CustomDomainModel>): boolean => {
  return Boolean(values.isCustomCertificate);
};

/*
 * Whether the domain, as the dialog read it, has no key stored to keep: it
 * did not serve its own certificate. Every save that makes a domain serve
 * one checks that it comes with its key (UploadedCertificate), so a domain
 * that serves one has a key.
 */
export const hasNoStoredCertificateKey: (
  storedValues: FormValues<CustomDomainModel>,
) => boolean = (storedValues: FormValues<CustomDomainModel>): boolean => {
  return !storedValues.isCustomCertificate;
};

export function getCustomDomainCertificateFields(): Array<
  ModelField<CustomDomainModel>
> {
  return [
    {
      field: {
        isCustomCertificate: true,
      },
      title: "Upload Custom Certificate",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: false,
      description:
        "If you have a custom certificate, you can upload it here. If you do not have a certificate, we will order a free SSL certificate for you.",
      doNotShowWhenCreating: true,
    },
    {
      field: {
        customCertificate: true,
      },
      title: "Certificate",
      fieldType: FormFieldSchemaType.LongText,
      required: servesOwnCertificate,
      placeholder:
        "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
      disableSpellCheck: true,
      hideColumnDescription: true,
      showIf: servesOwnCertificate,
      ownsServerError: isUploadedCertificateRefusal,
      doNotShowWhenCreating: true,
    },
    {
      field: {
        customCertificateKey: true,
      },
      title: "Certificate Private Key",
      fieldType: FormFieldSchemaType.LongText,
      required: servesOwnCertificate,
      // Why the key is asked for, and that it is never shown again.
      description:
        "OneUptime needs this key to serve your domain over HTTPS. It is stored encrypted and never shown again.",
      placeholder:
        "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
      disableSpellCheck: true,
      hideColumnDescription: true,
      showIf: servesOwnCertificate,
      hasNothingStoredWhenEditing: hasNoStoredCertificateKey,
      ownsServerError: isUploadedKeyRefusal,
      doNotShowWhenCreating: true,
    },
  ];
}
