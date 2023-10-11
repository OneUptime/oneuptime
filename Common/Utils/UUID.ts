import {
    v1 as uuidv1,
    validate as uuidValidate,
    version as uuidVersion,
} from 'uuid';

export default class UUID {
    public static generate(): string {
        return uuidv1();
    }

    public static validate(uuid: string, version: number = 1): boolean {
        return uuidValidate(uuid) && uuidVersion(uuid) === version;
    }
}
