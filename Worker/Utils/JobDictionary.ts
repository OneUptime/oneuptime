import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

export default class JobDictionary {
  private static dictionary: Dictionary<PromiseVoidFunction> = {};

  private static timeoutInMsDictionary: Dictionary<number> = {};

  public static getJobFunction(name: string): PromiseVoidFunction {
    if (this.dictionary[name]) {
      return this.dictionary[name] as PromiseVoidFunction;
    }

    throw new BadDataException("No job found with name: " + name);
  }

  public static setJobFunction(name: string, job: PromiseVoidFunction): void {
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
