export default class ObjectUtil {
    public static isEmpty(object: object): boolean {
        // check if object is empty
        return Object.keys(object).length === 0;
    }
}
