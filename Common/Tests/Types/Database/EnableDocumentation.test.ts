import BaseModel from '../../../Models/BaseModel';
import EnableDocumentation from '../../../Types/Database/EnableDocumentation';

describe('EnableDocumentation', () => {
    test('without EnableDocumentation', () => {
        class Test extends BaseModel{};

        expect(new Test().enableDocumentation).toBe(undefined);
        expect(new Test().isMasterAdminApiDocs).toBe(undefined);
    });

    test('enableDocumentation no props', () => {
        @EnableDocumentation()
        class Test extends BaseModel{};

        expect(new Test().enableDocumentation).toBe(true);
        expect(new Test().isMasterAdminApiDocs).toBe(false);
    });

    test.each([
        [{isMasterAdminApiDocs: true}, {isMasterAdminApiDocs: true}],
        [{isMasterAdminApiDocs: false}, {isMasterAdminApiDocs: false}],
        [{isMasterAdminApiDocs: undefined}, {isMasterAdminApiDocs: false}],
    ])('enableDocumentation with props = %o', (props, expected) => {
        @EnableDocumentation(props)
        class Test extends BaseModel{};

        expect(new Test().enableDocumentation).toBe(true);
        expect(new Test().isMasterAdminApiDocs).toBe(expected.isMasterAdminApiDocs);
    });
});
