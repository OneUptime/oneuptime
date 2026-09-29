import { createFixtureModule } from "../../FixtureModuleFactory";

// The first license snapshot load never settles: the wait must be bounded.
export default createFixtureModule("LicenseLoadHangs", {
  licenseLoad: "hang",
});
