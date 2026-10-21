import Handlebars from "handlebars";

/*
 * The helpers FeatureSet/Notification/Utils/Handlebars.ts registers for an
 * email to name the product - brandName and brandNameHtml - and the concat
 * that joins every argument they are passed with, for the template tests
 * that mirror that module's helpers instead of importing it (it resolves the
 * partials directory from process.cwd()). EmailBrandingTemplates.test.ts
 * renders with these and with the module's own and expects the same email.
 */

type HandlebarsEngine = typeof Handlebars;

// The name on the email's root (brandProductName), or OneUptime.
const brandNameOf: (options: unknown) => string = (
  options: unknown,
): string => {
  const root: unknown = (options as { data?: { root?: unknown } } | undefined)
    ?.data?.root;
  const productName: unknown =
    root && typeof root === "object"
      ? (root as Record<string, unknown>)["brandProductName"]
      : undefined;

  return typeof productName === "string" && productName.trim().length > 0
    ? productName
    : "OneUptime";
};

export const registerEmailBrandHelpers: (
  handlebars: HandlebarsEngine,
) => void = (handlebars: HandlebarsEngine): void => {
  handlebars.registerHelper("brandName", (options: unknown): string => {
    return brandNameOf(options);
  });

  handlebars.registerHelper("brandNameHtml", (options: unknown): string => {
    return handlebars.escapeExpression(brandNameOf(options));
  });
};

export const registerJoiningConcat: (handlebars: HandlebarsEngine) => void = (
  handlebars: HandlebarsEngine,
): void => {
  handlebars.registerHelper("concat", (...args: Array<unknown>): string => {
    return args
      .slice(0, -1)
      .map((value: unknown): string => {
        return value === null || value === undefined ? "" : String(value);
      })
      .join("");
  });
};
