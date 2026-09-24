import { createFixtureModule } from "../../FixtureModuleFactory";

// init() rejects (a database blip at boot): the loader must log and continue.
export default createFixtureModule("InitThrows", { init: "throw" });
