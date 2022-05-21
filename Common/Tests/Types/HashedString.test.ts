import HashedString from '../../Types/HashedString';
import ObjectID from '../../Types/ObjectID';
describe('class HashedString', () => {
    test('HashedString.constructor() should return valid hashedString', () => {
        const hashedString: HashedString = new HashedString('stringToHash');
        expect(hashedString).toBeInstanceOf(HashedString);
        expect(hashedString.hashValue(ObjectID.generate())).toBeCalled();
    });
});
