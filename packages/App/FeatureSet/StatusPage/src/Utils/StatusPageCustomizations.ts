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

  new Function(permittedJavaScript)();
};
