import ObjectID from '../../Types/ObjectID';

describe('class ObjectID', () => {
    test('ObjectID.constructor should return a valid ObjectID object', () => {
        const objectID: ObjectID = new ObjectID('id');
        expect(objectID.id).toBe('id');
    });
    test('ObjectID.fromString() should create ObjectID', () => {
        expect(ObjectID.fromString('id')).toBeInstanceOf(ObjectID);
    });
    test('Should create ObjectId through transformer', () => {});
});
