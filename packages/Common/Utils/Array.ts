import ObjectID from "../Types/ObjectID";

export default class ArrayUtil {
  /*
   * Run handler over every item, at most `concurrency` of them in flight.
   *
   * For work that is spent waiting on the network rather than on the CPU -
   * walking a list of customer domains and making a request against each -
   * awaiting one at a time leaves the caller idle for almost all of its wall
   * clock, and a single slow item delays every item behind it.
   *
   * Items are handed out in order, so a caller that has sorted by urgency still
   * gets the urgent ones started first. handler is expected to deal with its
   * own failures: as with Promise.all, the first rejection is what the caller
   * sees, and it does not stop work already in flight.
   */
  public static async forEachWithConcurrency<T>(
    array: Array<T>,
    concurrency: number,
    handler: (item: T) => Promise<void>,
  ): Promise<void> {
    let nextIndex: number = 0;

    const worker: () => Promise<void> = async (): Promise<void> => {
      while (nextIndex < array.length) {
        const index: number = nextIndex++;
        await handler(array[index] as T);
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.max(1, Math.min(concurrency, array.length)) },
        (): Promise<void> => {
          return worker();
        },
      ),
    );
  }

  public static mergeStringArrays(
    array1: Array<string>,
    array2: Array<string>,
  ): Array<string> {
    return ArrayUtil.removeDuplicates([...array1, ...array2]);
  }

  public static isStringArrayEqual(
    array1: Array<string>,
    array2: Array<string>,
  ): boolean {
    return ArrayUtil.isEqual(array1, array2);
  }

  public static removeDuplicates(array: Array<any>): Array<any> {
    return array.filter((value: any, index: number, self: Array<any>) => {
      return self.indexOf(value) === index;
    });
  }

  public static shuffle<T>(array: Array<T>): Array<T> {
    const shuffledArray: Array<T> = [...array];
    for (let i: number = shuffledArray.length - 1; i > 0; i--) {
      const j: number = Math.floor(Math.random() * (i + 1));

      if (!shuffledArray[i]) {
        continue;
      }

      if (!shuffledArray[j]) {
        continue;
      }

      [shuffledArray[i] as any, shuffledArray[j] as any] = [
        shuffledArray[j],
        shuffledArray[i],
      ];
    }
    return shuffledArray;
  }

  public static removeDuplicatesFromObjectIDArray(
    array: Array<ObjectID>,
  ): Array<ObjectID> {
    const distinctIds: Array<ObjectID> = [];

    for (const objectId of array) {
      if (
        distinctIds.filter((item: ObjectID) => {
          return item.toString() === objectId.toString();
        }).length > 0
      ) {
        continue;
      }

      distinctIds.push(objectId);
    }

    return distinctIds;
  }

  public static isEqual(a: Array<any>, b: Array<any>): boolean {
    // Check if the arrays have the same length
    if (a.length !== b.length) {
      return false;
    }

    // Sort both arrays by their JSON representation
    const sortedArr1: string = JSON.stringify([...a].sort());
    const sortedArr2: string = JSON.stringify([...b].sort());

    // Compare the sorted arrays
    return sortedArr1 === sortedArr2;
  }

  public static sortByFieldName(fieldName: string): (a: any, b: any) => number {
    return (a: any, b: any): number => {
      if (a[fieldName] < b[fieldName]) {
        return -1;
      }
      if (a[fieldName] > b[fieldName]) {
        return 1;
      }
      return 0;
    };
  }

  public static selectItemByRandom<T>(array: Array<T>): T {
    return array[Math.floor(Math.random() * array.length)]!;
  }

  public static distinctByFieldName(
    array: Array<any>,
    fieldName: string,
  ): Array<any> {
    // Get the distinct values by field name of the array
    const distinctValues: Array<any> = array
      .map((item: any) => {
        return item[fieldName];
      })
      .filter((value: any, index: number, self: Array<any>) => {
        return self.indexOf(value) === index;
      });

    // Create a new array with the distinct values
    const distinctArray: Array<any> = [];
    for (const value of distinctValues) {
      const item: any = array.find((item: any) => {
        return item[fieldName] === value;
      });
      distinctArray.push(item);
    }

    return distinctArray;
  }
}
