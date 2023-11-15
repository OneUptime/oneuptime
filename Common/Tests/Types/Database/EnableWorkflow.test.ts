import BaseModel from '../../../Models/BaseModel';
import EnableWorkflow from '../../../Types/Database/EnableWorkflow';

describe('EnableWorkflow', () => {
    test('without EnableWorkflow', () => {
        class Test extends BaseModel{};

        expect(new Test().enableWorkflowOn).toBe(undefined);
    });

    test.each([
        [
            {read: true}, {read: true}
        ],
        [{
            create: true,
            update: false,
            delete: true,
            read: true,
        }, {
            create: true,
            update: false,
            delete: true,
            read: true,
        }],
        [{
            create: true,
            update: true,
            read: true,
        }, {
            create: true,
            update: true,
            delete: undefined,
            read: true,
        }],
    ])('EnableWorkflow with options = %o', (props, expected) => {
        @EnableWorkflow(props)
        class Test extends BaseModel{};

        expect(new Test().enableWorkflowOn).toEqual(expected);
    });
});
