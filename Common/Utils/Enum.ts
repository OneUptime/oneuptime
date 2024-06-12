import GenericObject from '../Types/GenericObject';

export default class EnumUtil {
    public static isValidEnumValue<T extends GenericObject>(
        enumType: T,
        value: any
    ): boolean {
        return this.getValues(enumType).includes(value);
    }

    public static getValues<T extends GenericObject>(
        enumType: T
    ): Array<string> {
        return Object.values(enumType);
    }
}
