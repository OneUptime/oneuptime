import HashedString from '../../Types/HashedString';
import ObjectID from '../../Types/ObjectID';
describe('class HashedString', () => {
    test('HashedString.constructor() should return valid hashedString', () => {
        const hashedString: HashedString = new HashedString('stringToHash');
        expect(hashedString).toBeInstanceOf(HashedString);
        expect(hashedString.isValueHashed()).toBe(false);
        expect(hashedString.hashValue(ObjectID.generate())).toBeTruthy();
    });

    // TODO: Make this test pass. 
    test.skip('should SHA256 hash', () => {
        const hashedString: HashedString = new HashedString('stringToHash');
        expect(hashedString).toBeInstanceOf(HashedString);
        expect(hashedString.isValueHashed()).toBe(false);
        expect(hashedString.hashValue(null)).toBe("d3cd003df301cb1adf26fd3af623a0d372403f71b23bd099511cee06e7029b37");
    });
});
