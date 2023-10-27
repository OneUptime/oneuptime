import NotImplementedException from '../../Types/Exception/NotImplementedException';
import { JSONObject } from '../../Types/JSON';
import SerializableObject from '../../Types/SerializableObject';

describe('SerializableObject Class', () => {
    let serializableObject: SerializableObject;

    beforeEach(() => {
        serializableObject = new SerializableObject();
    });

    test('Constructor initializes an instance of SerializableObject', () => {
        expect(serializableObject).toBeInstanceOf(SerializableObject);
    });

    describe('toJSON Method', () => {
        test('Throws NotImplementedException when called', () => {
            expect(() => {
                return serializableObject.toJSON();
            }).toThrow(NotImplementedException);
        });
    });

    describe('fromJSON Method', () => {
        test('Throws NotImplementedException when called', () => {
            expect(() => {
                return SerializableObject.fromJSON({});
            }).toThrow(NotImplementedException);
        });
    });

    describe('fromJSON Instance Method', () => {
        test('Returns the result from the static fromJSON method', () => {
            const json: JSONObject = { key: 'value' };
            const expectedResult: SerializableObject = new SerializableObject();
            jest.spyOn(SerializableObject, 'fromJSON').mockReturnValue(
                expectedResult
            );
            const result: SerializableObject =
                serializableObject.fromJSON(json);
            expect(result).toBe(expectedResult);
        });
    });
});
