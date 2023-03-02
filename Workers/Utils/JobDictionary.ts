import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";

export default class JobDictonary {
    
    private static dictionary : Dictionary<Function> = {};
   
    public static getJobFunction(name: string): Function {
        if(this.dictionary[name]){
            return this.dictionary[name] as Function;
        }

        throw new BadDataException("No job found with name: "+name);
    }

    public static setJobFunction(name: string, job: Function): void {
        this.dictionary[name] = job;
    }
    
}