import IsNull from '../../../Types/Database/IsNull';
import BadDataException from '../../../Types/Exception/BadDataException';
import { JSONObject } from '../../../Types/JSON';

describe('IsNull', () => {
    describe('toString', () => {
        it('should return the correct string representation', () => {
            const isNull = new IsNull();
            expect(isNull.toString()).toEqual('');
        });
    });

    describe('toJSON', () => {
        it('should generate the correct JSON representation', () => {
            const isNull = new IsNull();
            const expectedJSON: JSONObject = {
                _type: 'IsNull',
                value: null,
            };
            expect(isNull.toJSON()).toEqual(expectedJSON);
        });
    });

    describe('fromJSON', () => {
        it('should create an IsNull object from valid JSON input', () => {
            const jsonInput: JSONObject = {
                _type: 'IsNull',
                value: null,
            };
            const isNull: IsNull = IsNull.fromJSON(jsonInput);
            expect(isNull.toString()).toBe('');
        });

        it('should throw a BadDataException when using invalid JSON input', () => {
            const jsonInput: JSONObject = {
                _type: 'InvalidType',
                value: null,
            };
            expect(() => {
                return IsNull.fromJSON(jsonInput);
            }).toThrow(BadDataException);
        });
    });
});
