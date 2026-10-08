import {
  getProductLogoSource,
  PAGE_PRODUCT_NAME_CLASS_NAME,
} from "../ProductLogo/ProductLogo";
import { getProductName } from "../../Utils/ProductBranding";
import { Theme } from "../../Utils/Theme";
import {
  getPublicFormImageUrl,
  PublicFormImage,
} from "../../../Types/Form/FormBranding";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The logo at the top of a form's public page: the form's own when it has
 * one (its Branding), and the product's logo until then - OneUptime's, or
 * the installation's own when it has one (ProductBranding), or its name when
 * it goes by a name of its own and has no logo - or when the form's own
 * cannot be drawn, so the page never shows a broken image. Drawn by the
 * public page (Accounts Pages/Form.tsx) and by the dashboard's preview of
 * it, so the preview shows what a visitor sees.
 *
 * The form's logo is drawn from the data: URL the form's own public read
 * carries (FormBranding): it is never fetched from an address of its own.
 * It keeps the OneUptime logo's height, and a wide one is kept inside the
 * page's width.
 */

export const PUBLIC_FORM_LOGO_TEST_ID: string = "form-logo";

// Which logo is drawn, on the image itself (data-logo), for tests.
export enum PublicFormLogoSource {
  Form = "form",
  OneUptime = "oneuptime",
}

export interface ComponentProps {
  // The form's logo. Without one, the OneUptime logo.
  logo?: PublicFormImage | undefined;
  /*
   * What the form's logo says, for screen readers. Without it, the logo is
   * left out of what they read: the form's name follows right below it.
   */
  altText?: string | undefined;
  className?: string | undefined;
}

const PublicFormLogo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const source: string | null = props.logo
    ? getPublicFormImageUrl(props.logo)
    : null;

  // The form's logo that would not draw: the OneUptime logo stands in for it.
  const [failedSource, setFailedSource] = useState<string | null>(null);

  const className: string =
    `mx-auto h-10 w-auto max-w-full object-contain sm:h-12 ${
      props.className || ""
    }`.trim();

  if (!source || failedSource === source) {
    const productLogoSource: string | null = getProductLogoSource(Theme.Light);

    if (!productLogoSource) {
      return (
        <div
          className={`${PAGE_PRODUCT_NAME_CLASS_NAME} ${
            props.className || ""
          }`.trim()}
          data-testid={PUBLIC_FORM_LOGO_TEST_ID}
          data-logo={PublicFormLogoSource.OneUptime}
        >
          {getProductName()}
        </div>
      );
    }

    return (
      <img
        className={className}
        src={productLogoSource}
        alt={getProductName()}
        data-testid={PUBLIC_FORM_LOGO_TEST_ID}
        data-logo={PublicFormLogoSource.OneUptime}
      />
    );
  }

  return (
    <img
      className={className}
      src={source}
      alt={props.altText || ""}
      data-testid={PUBLIC_FORM_LOGO_TEST_ID}
      data-logo={PublicFormLogoSource.Form}
      onError={() => {
        setFailedSource(source);
      }}
    />
  );
};

export default PublicFormLogo;
