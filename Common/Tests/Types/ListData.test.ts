import { JSONArray, JSONObject } from '../../Types/JSON';
import ListData from '../../Types/ListData';
import PositiveNumber from '../../Types/PositiveNumber';

describe('ListData', () => {
    test('should create a ListData instance', () => {
        const data: JSONArray = [{ foo: 1 }, { foo: 2 }];
        const skip: PositiveNumber = new PositiveNumber(0);
        const count: PositiveNumber = new PositiveNumber(0);
        const limit: PositiveNumber = new PositiveNumber(0);

        const listData: ListData = new ListData({
            data,
            count,
            skip,
            limit,
        });
        expect(listData).toBeInstanceOf(ListData);

        expect(listData.count.toNumber()).toBe(count.toNumber());
        expect(listData.skip.toNumber()).toBe(skip.toNumber());
        expect(listData.limit.toNumber()).toBe(limit.toNumber());
    });

    test('toJSON converts ListData to JSONObject', () => {
        const listData: ListData = new ListData({
            data: [{ foo: 'bar' }],
            count: new PositiveNumber(0),
            skip: new PositiveNumber(0),
            limit: new PositiveNumber(0),
        });

        const jsonObject: JSONObject = listData.toJSON();

        expect(jsonObject['data']).toEqual([{ foo: 'bar' }]);
        expect(jsonObject['count']).toEqual(0);
        expect(jsonObject['skip']).toEqual(0);
        expect(jsonObject['limit']).toEqual(0);
    });
});
