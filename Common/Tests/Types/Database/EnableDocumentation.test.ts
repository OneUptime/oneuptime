import BaseModel from '../../../Models/BaseModel';
import EnableDocumentation, {
    EnableDocumentationProps,
} from '../../../Types/Database/EnableDocumentation';

describe('EnableDocumentation', () => {
    test('without EnableDocumentation', () => {
        class Test extends BaseModel {}

        expect(new Test().enableDocumentation).toBe(undefined);
        expect(new Test().isMasterAdminApiDocs).toBe(undefined);
    });

    test('enableDocumentation no props', () => {
        @EnableDocumentation()
        class Test extends BaseModel {}

        expect(new Test().enableDocumentation).toBe(true);
        expect(new Test().isMasterAdminApiDocs).toBe(false);
    });

    const testCases: [EnableDocumentationProps, { [key: string]: boolean }][] =
        [
            [{ isMasterAdminApiDocs: true }, { isMasterAdminApiDocs: true }],
            [{ isMasterAdminApiDocs: false }, { isMasterAdminApiDocs: false }],
            [
                { isMasterAdminApiDocs: undefined },
                { isMasterAdminApiDocs: false },
            ],
        ];

    test.each(testCases)(
        'enableDocumentation with props = %o',
        (
            props: EnableDocumentationProps,
            expected: { [key: string]: boolean }
        ) => {
            @EnableDocumentation(props)
            class Test extends BaseModel {}

            expect(new Test().enableDocumentation).toBe(true);
            expect(new Test().isMasterAdminApiDocs).toBe(
                expected.isMasterAdminApiDocs
            );
        }
    );
});
