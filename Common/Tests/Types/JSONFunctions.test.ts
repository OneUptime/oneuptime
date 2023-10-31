import BaseModel from '../../Models/BaseModel';
import { JSONObject } from '../../Types/JSON';
import JSONFunctions from '../../Types/JSONFunctions';

describe('JSONFunctions Class', () => {
    let baseModel: BaseModel;

    beforeEach(() => {
        baseModel = new BaseModel();
    });

    describe('isEmptyObject Method', () => {
        test('Returns true for an empty object', () => {
            const emptyObj: JSONObject = {};
            expect(JSONFunctions.isEmptyObject(emptyObj)).toBe(true);
        });

        test('Returns false for a non-empty object', () => {
            const nonEmptyObj: JSONObject = { key: 'value' };
            expect(JSONFunctions.isEmptyObject(nonEmptyObj)).toBe(false);
        });

        test('Returns true for null or undefined', () => {
            expect(JSONFunctions.isEmptyObject(null)).toBe(true);
            expect(JSONFunctions.isEmptyObject(undefined)).toBe(true);
        });
    });

    describe('toJSON and fromJSON Methods', () => {
        test('toJSON returns a valid JSON object', () => {
            const json: JSONObject = JSONFunctions.toJSON(baseModel, BaseModel);
            expect(json).toEqual(expect.objectContaining({}));
        });

        test('toJSONObject returns a valid JSON object', () => {
            const json: JSONObject = JSONFunctions.toJSONObject(
                baseModel,
                BaseModel
            );
            expect(json).toEqual(expect.objectContaining({}));
        });

        test('fromJSON returns a BaseModel instance', () => {
            const json: JSONObject = { name: 'oneuptime' };
            const result: BaseModel | BaseModel[] = JSONFunctions.fromJSON(
                json,
                BaseModel
            );
            expect(result).toBeInstanceOf(BaseModel);
        });
    });
});
