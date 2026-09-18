import { createFixtureModule } from "../../FixtureModuleFactory";

// init() never settles: the loader's timeout must let the boot continue.
export default createFixtureModule("InitHangs", { init: "hang" });
