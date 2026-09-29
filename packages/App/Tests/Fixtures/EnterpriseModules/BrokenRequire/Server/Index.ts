import { createFixtureModule } from "../../FixtureModuleFactory";

/*
 * Models ee/ copied into place without `npm ci` having run in it: one of its
 * dependencies is not installed, so require() of the entry file throws.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
require("missing-enterprise-fixture-dependency");

export default createFixtureModule("BrokenRequire");
