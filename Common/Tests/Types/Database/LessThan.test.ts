import LessThan from '../../../Types/Database/LessThan';
import BadDataException from '../../../Types/Exception/BadDataException';
import { JSONObject } from '../../../Types/JSON';

describe('LessThan', () => {
    describe('toJSON', () => {
        it('number - should generate the correct JSON representation', () => {
            const lessThan = new LessThan(2023);
            const expectedJSON: JSONObject = {
                _type: 'LessThan',
                value: 2023,
            };
            expect(lessThan.toJSON()).toEqual(expectedJSON);
        });

        it('date - should generate the correct JSON representation', () => {
            const now = new Date();
            const lessThan = new LessThan(now);
            const expectedJSON: JSONObject = {
                _type: 'LessThan',
                value: now.toJSON(),
            };
            expect(lessThan.toJSON()).toEqual(expectedJSON);
        });
    });

    describe('fromJSON', () => {
        it('number - should create an LessThan object from valid JSON input', () => {
            const jsonInput: JSONObject = {
                _type: 'LessThan',
                value: 2023,
            };
            const lessThan: LessThan = LessThan.fromJSON(jsonInput);
            expect(lessThan.value).toBe(2023);
        });

        it('date - should create an LessThan object from valid JSON input', () => {
            const now = new Date();
            const jsonInput: JSONObject = {
                _type: 'LessThan',
                value: now.toJSON(),
            };
            const lessThan: LessThan = LessThan.fromJSON(jsonInput);
            expect(lessThan.value).toEqual(now);
        });

        it('should throw a BadDataException when using invalid JSON input - type', () => {
            const jsonInput: JSONObject = {
                _type: 'InvalidType',
                value: 42,
            };
            expect(() => {
                return LessThan.fromJSON(jsonInput);
            }).toThrow(BadDataException);
        });

        it('should throw a BadDataException when using invalid JSON input - value', () => {
            const jsonInput: JSONObject = {
                _type: 'LessThan',
                value: '123string',
            };
            expect(() => {
                return LessThan.fromJSON(jsonInput);
            }).toThrow(BadDataException);
        });

        it('should throw a BadDataException when using invalid JSON input - date', () => {
            const jsonInput: JSONObject = {
                _type: 'LessThan',
                value: '2023-13-35',
            };
            expect(() => {
                return LessThan.fromJSON(jsonInput);
            }).toThrow(BadDataException);
        });
    });
});

