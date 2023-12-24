import BaseModel from '../../../Models/BaseModel';
import EnableWorkflow from '../../../Types/Database/EnableWorkflow';
import EnableWorkflowOn from '../../../Types/BaseDatabase/EnableWorkflowOn';

describe('EnableWorkflow', () => {
    test('without EnableWorkflow', () => {
        class Test extends BaseModel {}

        expect(new Test().enableWorkflowOn).toBe(undefined);
    });

    const testCases: [EnableWorkflowOn, EnableWorkflowOn][] = [
        [{ read: true }, { read: true }],
        [
            {
                create: true,
                update: false,
                delete: true,
                read: true,
            },
            {
                create: true,
                update: false,
                delete: true,
                read: true,
            },
        ],
        [
            {
                create: true,
                update: true,
                read: true,
            },
            {
                create: true,
                update: true,
                delete: undefined,
                read: true,
            },
        ],
    ];

    test.each(testCases)(
        'EnableWorkflow with options = %o',
        (props: EnableWorkflowOn, expected: EnableWorkflowOn) => {
            @EnableWorkflow(props)
            class Test extends BaseModel {}

            expect(new Test().enableWorkflowOn).toEqual(expected);
        }
    );
});
