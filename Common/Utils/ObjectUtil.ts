export default class ObjectUtil {
    public static isEmpty(object: Object): boolean {
        for (var prop in object) {
            if (object.hasOwnProperty(prop)) return false;
        }

        return true;
    }
}