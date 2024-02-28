import Dictionary from 'Common/Types/Dictionary';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';

export default class JobDictionary {
    private static dictionary: Dictionary<PromiseVoidFunction> = {};

    public static getJobFunction(name: string): PromiseVoidFunction {
        if (this.dictionary[name]) {
            return this.dictionary[name] as PromiseVoidFunction;
        }

        throw new BadDataException('No job found with name: ' + name);
    }

    public static setJobFunction(name: string, job: PromiseVoidFunction): void {
        this.dictionary[name] = job;
    }
}
