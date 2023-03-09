export default class ArrayUtil {
    public static isEqual(a: Array<any>, b: Array<any>): boolean {
        // Check if the arrays have the same length
        if (a.length !== b.length) {
            return false;
        }

        // Sort both arrays by their JSON representation
        const sortedArr1 = JSON.stringify([...a].sort());
        const sortedArr2 = JSON.stringify([...b].sort());

        // Compare the sorted arrays
        return sortedArr1 === sortedArr2;
    }
}
