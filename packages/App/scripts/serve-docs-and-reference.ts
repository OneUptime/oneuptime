/*
 * The docs (/docs) and the API reference (/reference) on their own, with no
 * Postgres, Redis or ClickHouse: the two feature sets render from files in
 * the repository, so they need none of the App's datastores, which the rest
 * of the App does.
 *
 *   PORT=4802 node -r ts-node/register/transpile-only scripts/serve-docs-and-reference.ts
 *
 * The Lighthouse suite (packages/E2E/Lighthouse) starts it to scan the docs
 * and the reference as a pull request changes them. The routes are the App's
 * own, mounted the way Index.ts mounts them, behind the same vendor assets
 * and default routes, so a page is the page oneuptime.com serves.
 */
import APIReferenceRoutes from "../FeatureSet/APIReference/Index";
import DocsRoutes from "../FeatureSet/Docs/Index";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import "ejs";

const APP_NAME: string = "docs";

const init: PromiseVoidFunction = async (): Promise<void> => {
  await App.init({
    appName: APP_NAME,
    statusOptions: {
      liveCheck: async () => {},
      readyCheck: async () => {},
    },
    // Neither feature set reads anything ENCRYPTION_SECRET protects.
    usesEncryptionSecret: false,
  });

  await DocsRoutes.init();
  await APIReferenceRoutes.init();

  await App.addDefaultRoutes();
};

init().catch((err: Error) => {
  logger.error(err, { service: APP_NAME });
  logger.error("Exiting node process", { service: APP_NAME });
  process.exit(1);
});
