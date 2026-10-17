import SensitiveUrlToken from "Common/UI/Utils/SensitiveUrlToken";

export interface StatusPageCustomizationContext {
  allowStatusPageCustomizations: unknown;
  isPreview: boolean;
}

export const canUseStatusPageCustomizations: (
  context: StatusPageCustomizationContext,
) => boolean = (context: StatusPageCustomizationContext): boolean => {
  return context.allowStatusPageCustomizations === true && !context.isPreview;
};

export const getPermittedStatusPageCustomization: (
  customization: string | null | undefined,
  context: StatusPageCustomizationContext,
) => string | null = (
  customization: string | null | undefined,
  context: StatusPageCustomizationContext,
): string | null => {
  if (!canUseStatusPageCustomizations(context) || !customization) {
    return null;
  }

  return customization;
};

/*
 * Whether the page at this path may show the status page's custom header
 * and footer HTML. Custom HTML can run script (an image's error handler,
 * say), and a page that works with a credential from a link runs none of the
 * page's custom code: a subscription's manage page shows the page's own
 * header and footer instead. (The unsubscribe, reset password and sign-in
 * pages are shown on their own, without either.)
 */
export const canRenderStatusPageCustomHtml: (data: {
  context: StatusPageCustomizationContext;
  pathname: string;
}) => boolean = (data: {
  context: StatusPageCustomizationContext;
  pathname: string;
}): boolean => {
  return (
    canUseStatusPageCustomizations(data.context) &&
    !SensitiveUrlToken.isTokenRoute(data.pathname)
  );
};

/*
 * What the tab lets go of before the page's custom code runs - its
 * JavaScript, or header and footer HTML that can run script: the credential
 * a link to a subscription's manage or unsubscribe page, or a reset password
 * link, left with it (SensitiveUrlToken). No custom code ever runs beside
 * one: the pages that use it run none, and leaving them for a page that does
 * drops it first.
 */
export const releaseCredentialsBeforeCustomCode: () => void = (): void => {
  SensitiveUrlToken.clear();
};

export const executeStatusPageCustomJavaScript: (
  javascript: string | null | undefined,
  context: StatusPageCustomizationContext,
) => void = (
  javascript: string | null | undefined,
  context: StatusPageCustomizationContext,
): void => {
  const permittedJavaScript: string | null =
    getPermittedStatusPageCustomization(javascript, context);

  if (!permittedJavaScript) {
    return;
  }

  releaseCredentialsBeforeCustomCode();

  new Function(permittedJavaScript)();
};
