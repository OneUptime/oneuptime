import MonitorSteps from "./MonitorSteps";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

/*
 * HOW A MONITOR'S STEPS ARE WRITTEN TO THE DATABASE AND READ BACK.
 *
 * The steps column of the Monitor, MonitorTemplate and MonitorTest models
 * (TypeORM's `transformer`). Only the server has a database, and only it
 * calls this. A browser build takes MonitorStepsColumnTransformer.browser.ts
 * in its place (the "browser" field of packages/Common/package.json), so a
 * page that draws a monitor - a status page, a public dashboard - does not
 * download every monitor type with the model: some 147 KB before gzip that
 * it never runs (issue #8821).
 *
 * Here, in Node, the model loads MonitorSteps with it, and so every program
 * that has the model - the API, the workers, the probe - reads a monitor's
 * steps back from JSON (MonitorSteps joins JSON reading as it loads,
 * Types/JoinedSerializableObjects).
 */
const MonitorStepsColumnTransformer: ValueTransformer =
  MonitorSteps.getDatabaseTransformer();

export default MonitorStepsColumnTransformer;
