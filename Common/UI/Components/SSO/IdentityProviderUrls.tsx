import Card from "../Card/Card";
import AlertBanner, { AlertBannerType } from "../AlertBanner/AlertBanner";
import CodeBlock from "../CodeBlock/CodeBlock";
import CollapsibleSection from "../CollapsibleSection/CollapsibleSection";
import InlineCode from "../InlineCode/InlineCode";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // Fully computed ACS / Reply URL (already includes the /identity segment).
  acsUrl: string;
  // Fully computed Entity ID / Issuer (does NOT include /identity).
  entityId: string;
  // Label overrides so each screen can keep its own wording.
  acsLabel?: string | undefined;
  entityIdLabel?: string | undefined;
  // When true (default) the body is wrapped in its own titled Card.
  renderInCard?: boolean | undefined;
  className?: string | undefined;
}

/*
 * Shared presentational block that shows the ACS URL and Entity ID an admin must
 * paste into their SAML identity provider, plus the exact-match rules and the
 * Azure AADSTS700016 workaround. It intentionally takes precomputed strings:
 * Global / Project / Status Page SSO each build these URLs with different
 * formulas, so the component must not try to construct them.
 */
const IdentityProviderUrls: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const acsLabel: string =
    props.acsLabel || "ACS URL (Reply URL / Assertion Consumer Service)";
  const entityIdLabel: string =
    props.entityIdLabel || "Entity ID (Issuer / Identifier)";

  const body: ReactElement = (
    <div className={props.className}>
      <AlertBanner title="Enter these values exactly" type={AlertBannerType.Warning}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
          <li>
            Copy and paste each value — do not retype it. The values are
            case-sensitive and must have no trailing slash and no extra spaces.
          </li>
          <li>
            The Entity ID does not contain <InlineCode text="/identity" />, but
            the ACS URL does. Do not swap them — pasting one into the other&apos;s
            field is the most common cause of failed SSO.
          </li>
          <li>
            Your provider&apos;s app tile / &quot;My Apps&quot; (IdP-initiated)
            login can succeed even when the &quot;Sign in with SSO&quot; button
            (SP-initiated) is broken — they are validated separately by the
            identity provider. A working tile does not mean the button works.
            Always finish by testing the SSO button itself.
          </li>
        </ul>
      </AlertBanner>

      <div className="mt-4">
        <div className="mb-1 text-sm font-semibold text-gray-900">
          {acsLabel}
        </div>
        <CodeBlock code={props.acsUrl} language="plaintext" />
      </div>

      <div className="mt-4">
        <div className="mb-1 text-sm font-semibold text-gray-900">
          {entityIdLabel}
        </div>
        <CodeBlock code={props.entityId} language="plaintext" />
      </div>

      <div className="mt-4">
        <CollapsibleSection
          title="Using Azure AD / Entra ID? Fixing error AADSTS700016"
          variant="bordered"
          defaultCollapsed={true}
        >
          <div className="space-y-3 text-sm text-gray-600">
            <p>
              Azure validates the Entity ID exactly. If SP-initiated sign-in
              fails with &quot;AADSTS700016: Application not found in the
              directory&quot; even though the values above look correct, set the
              Sign On URL field above to the form below. OneUptime sends
              unsigned SAML AuthnRequests, so this tenant-scoped endpoint is a
              valid and supported workaround.
            </p>
            <CodeBlock
              code="https://login.microsoftonline.com/{tenant}/saml2/{servicePrincipalGuid}"
              language="plaintext"
            />
            <p>
              Replace <InlineCode text="{tenant}" /> with your Azure tenant ID
              (or domain) and <InlineCode text="{servicePrincipalGuid}" /> with
              the Object ID of the OneUptime Enterprise Application in Azure
              (Enterprise applications → your app → Overview → Object ID). Then
              test the &quot;Sign in with SSO&quot; button again.
            </p>
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );

  if (props.renderInCard === false) {
    return body;
  }

  return (
    <Card
      title="Identity Provider URLs"
      description="Paste these values into your SAML identity provider (Okta, Azure AD, OneLogin, JumpCloud and more)."
    >
      {body}
    </Card>
  );
};

export default IdentityProviderUrls;
