/*
 * The docs' and the API reference's views, pages and static files from this
 * checkout rather than the image's paths (/usr/src/app, where packages/App
 * sits in the App image), as their own tests read them (the jest.mock of
 * Utils/Config in Tests/FeatureSet/Docs and Tests/FeatureSet/APIReference).
 * Preloaded ahead of serve-docs-and-reference.ts, so the two feature sets run
 * from a checkout with nothing else changed:
 *
 *   PORT=4802 node -r ts-node/register/transpile-only \
 *     -r ./scripts/checkout-paths.ts scripts/serve-docs-and-reference.ts
 */
import * as APIReferenceConfig from "../FeatureSet/APIReference/Utils/Config";
import * as DocsConfig from "../FeatureSet/Docs/Utils/Config";
import fs from "fs";
import Module from "module";
import path from "path";

const ImageAppFolder: string = "/usr/src/app";
const CheckoutAppFolder: string = path.resolve(__dirname, "..");

function inThisCheckout(value: unknown): unknown {
  if (
    typeof value !== "string" ||
    !(value === ImageAppFolder || value.startsWith(`${ImageAppFolder}/`))
  ) {
    return value;
  }

  const checkoutPath: string = path.join(
    CheckoutAppFolder,
    value.slice(ImageAppFolder.length),
  );

  // A folder the image has and the checkout does not would fail a page later.
  if (!fs.existsSync(checkoutPath)) {
    throw new Error(`${value} is not in this checkout at ${checkoutPath}.`);
  }

  return checkoutPath;
}

function useCheckoutPaths(
  configModule: string,
  config: Record<string, unknown>,
): void {
  const configFile: string = require.resolve(configModule);
  const cached: Module | undefined = require.cache[configFile];

  if (!cached) {
    throw new Error(`${configFile} was imported but is not in require.cache.`);
  }

  // Every module that imports this config after this one gets these paths.
  cached.exports = Object.fromEntries(
    Object.entries(config).map(
      ([name, value]: [string, unknown]): [string, unknown] => {
        return [name, inThisCheckout(value)];
      },
    ),
  );
}

useCheckoutPaths("../FeatureSet/Docs/Utils/Config", DocsConfig);
useCheckoutPaths("../FeatureSet/APIReference/Utils/Config", APIReferenceConfig);
