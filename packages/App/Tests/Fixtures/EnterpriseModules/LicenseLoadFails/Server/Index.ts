import { createFixtureModule } from "../../FixtureModuleFactory";

// The first license snapshot load rejects: the boot must not fail.
export default createFixtureModule("LicenseLoadFails", {
  licenseLoad: "throw",
});
