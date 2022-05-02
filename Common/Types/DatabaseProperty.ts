import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";
import NotImplementedException from "./Exception/NotImplementedException";

export default class DatabaseProperty {
    constructor() {
        
    }

    public static getDatabaseTransformer(): ValueTransformer { 
        throw new NotImplementedException();
    }
}