import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import { QueueJob } from "Common/Server/Infrastructure/Queue";

export type WorkerJobFunction = (job?: QueueJob) => Promise<void>;

export default class JobDictionary {
  private static dictionary: Dictionary<WorkerJobFunction> = {};

  private static timeoutInMsDictionary: Dictionary<number> = {};

  public static getJobFunction(name: string): WorkerJobFunction {
    if (this.dictionary[name]) {
      return this.dictionary[name] as WorkerJobFunction;
    }

    throw new BadDataException("No job found with name: " + name);
  }

  /*
   * Whether a handler is registered under `name`. An own-property check, so
   * inherited names such as "toString" never count as registered jobs.
   */
  public static has(name: string): boolean {
    return (
      Object.prototype.hasOwnProperty.call(this.dictionary, name) &&
      typeof this.dictionary[name] === "function"
    );
  }

  public static setJobFunction(name: string, job: WorkerJobFunction): void {
    this.dictionary[name] = job;
  }

  public static getTimeoutInMs(name: string): number {
    const defaultTimeInMs: number =
      OneUptimeDate.convertMinutesToMilliseconds(5);
    if (this.timeoutInMsDictionary[name]) {
      return this.timeoutInMsDictionary[name] || defaultTimeInMs;
    }

    return defaultTimeInMs; // by default every job timeout is 5 minutes
  }

  public static setTimeoutInMs(name: string, timeoutInMs: number): void {
    this.timeoutInMsDictionary[name] = timeoutInMs;
  }
}
