import type { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

/*
 * The steps column's database transformer in a browser build, which takes
 * this file in place of MonitorStepsColumnTransformer.ts (the "browser"
 * field of packages/Common/package.json).
 *
 * A browser has no database, so TypeORM never calls a model's transformer
 * there: the Monitor model only needs one to be declared. This one needs
 * nothing, so the model does not bring MonitorSteps and every monitor type
 * into each page that draws a monitor (issue #8821). Called all the same, it
 * says where it is rather than write or read anything.
 */
const refuse: () => never = (): never => {
  throw new Error(
    "A monitor's steps are written to and read from the database on the server only.",
  );
};

const MonitorStepsColumnTransformer: ValueTransformer = {
  to: refuse,
  from: refuse,
};

export default MonitorStepsColumnTransformer;
