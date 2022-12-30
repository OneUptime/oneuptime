import { v1 as uuidv1 } from 'uuid';

export default class UUID {
    public static generate(): string {
        return uuidv1();
    }
}
