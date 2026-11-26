import { CA_CERTIFICATE_PLACEHOLDER } from "../../Runbook/HttpStepCertificates";
import { translationKey } from "../../Translator";
import { Argument, ComponentInputType } from "../Component";

/*
 * HOW A WORKFLOW API STEP CHECKS THE SERVER'S CERTIFICATE (issue #10440).
 *
 * A workflow on a self-hosted OneUptime often calls a service on its own
 * network, and that service often answers with a certificate a private CA
 * signed, or one it signed itself, which the step refused. A Runbook HTTP
 * step has two settings for it (#10277, Types/Runbook/HttpStepCertificates);
 * the six API steps (Get, Get By ID, Post, Put, Patch, Delete) have the
 * same two, under the step's More fields, named, worded and read as there:
 *
 *   - CA certificate: the certificate (PEM) of the CA that signed the
 *     server's certificate, or the server's own when it is self-signed. The
 *     step trusts it alone and still checks the host name and the dates.
 *     Shown while the switch is off: with it on, the certificate is not used;
 *   - Allow self-signed certificates: no check at all, so anyone on the
 *     network path could read the request, its headers' tokens included,
 *     and change the answer. On only when it is exactly true: a value an
 *     earlier step writes as the text "true" never turns the checks off.
 *
 * Both are off by default and reach that step's request alone: its own
 * https agent, never an outbound proxy's connection, never another request
 * (SafeWebhookRequest's tls). The server reads them in
 * Server/Types/Workflow/Components/API/Utils.
 */

export const ALLOW_SELF_SIGNED_CERTIFICATES_ARGUMENT_ID: string =
  "allow-self-signed-certificates";

export const CA_CERTIFICATE_ARGUMENT_ID: string = "ca-certificate";

export const API_CERTIFICATE_ARGUMENTS: Array<Argument> = [
  {
    id: ALLOW_SELF_SIGNED_CERTIFICATES_ARGUMENT_ID,
    name: translationKey("Allow self-signed certificates"),
    description: translationKey(
      "Skips certificate checks for this step's request, so self-signed certificates work, but anyone on the network path could read or change the request.",
    ),
    type: ComponentInputType.Boolean,
    required: false,
    isAdvanced: true,
  },
  {
    id: CA_CERTIFICATE_ARGUMENT_ID,
    name: translationKey("CA certificate"),
    description: translationKey(
      "The step trusts only this certificate (PEM): that of the CA that signed the server's certificate, or the server's own when it is self-signed.",
    ),
    type: ComponentInputType.LongText,
    required: false,
    isAdvanced: true,
    placeholder: CA_CERTIFICATE_PLACEHOLDER,
    // With the checks off, the certificate is not used.
    shownWhen: {
      argumentId: ALLOW_SELF_SIGNED_CERTIFICATES_ARGUMENT_ID,
      values: ["false"],
      includesEmpty: true,
    },
  },
];
