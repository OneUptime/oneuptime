import GreaterThan from '../../../Types/Database/GreaterThan';
import BadDataException from '../../../Types/Exception/BadDataException';
import { JSONObject } from '../../../Types/JSON';

describe('GreaterThan', () => {
    describe('toJSON', () => {
        it('number - should generate the correct JSON representation', () => {
            const greaterThan = new GreaterThan(2023);
            const expectedJSON: JSONObject = {
                _type: 'GreaterThan',
                value: 2023,
            };
            expect(greaterThan.toJSON()).toEqual(expectedJSON);
        });

        it('date - should generate the correct JSON representation', () => {
            const now = new Date();
            const greaterThan = new GreaterThan(now);
            const expectedJSON: JSONObject = {
                _type: 'GreaterThan',
                value: now.toJSON(),
            };
            expect(greaterThan.toJSON()).toEqual(expectedJSON);
        });
    });

    describe('fromJSON', () => {
        it('number - should create an GreaterThan object from valid JSON input', () => {
            const jsonInput: JSONObject = {
                _type: 'GreaterThan',
                value: 2023,
            };
            const greaterThan: GreaterThan = GreaterThan.fromJSON(jsonInput);
            expect(greaterThan.value).toBe(2023);
        });

        it('date - should create an GreaterThan object from valid JSON input', () => {
            const now = new Date();
            const jsonInput: JSONObject = {
                _type: 'GreaterThan',
                value: now.toJSON(),
            };
            const greaterThan: GreaterThan = GreaterThan.fromJSON(jsonInput);
            expect(greaterThan.value).toEqual(now);
        });

        it('should throw a BadDataException when using invalid JSON input - type', () => {
            const jsonInput: JSONObject = {
                _type: 'InvalidType',
                value: 42,
            };
            expect(() => {
                return GreaterThan.fromJSON(jsonInput);
            }).toThrow(BadDataException);
        });

        it('should throw a BadDataException when using invalid JSON input - value', () => {
            const jsonInput: JSONObject = {
                _type: 'GreaterThan',
                value: '123string',
            };
            expect(() => {
                return GreaterThan.fromJSON(jsonInput);
            }).toThrow(BadDataException);
        });

        it('should throw a BadDataException when using invalid JSON input - date', () => {
            const jsonInput: JSONObject = {
                _type: 'GreaterThan',
                value: '2023-13-35',
            };
            expect(() => {
                return GreaterThan.fromJSON(jsonInput);
            }).toThrow(BadDataException);
        });
    });
});
