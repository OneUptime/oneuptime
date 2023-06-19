import ComponentMetadata, {
    ComponentCategory,
    ComponentInputType,
} from 'Common/Types/Workflow/Component';
import FormFieldSchemaType from '../Forms/Types/FormFieldSchemaType';
import { DropdownOption } from '../Dropdown/Dropdown';
import Entities from 'Model/Models/Index';
import BaseModelComponentFactory from 'Common/Types/Workflow/Components/BaseModel';
import IconProp from 'Common/Types/Icon/IconProp';
import Components, { Categories } from 'Common/Types/Workflow/Components';
import Typeof from 'Common/Types/Typeof';

export const loadComponentsAndCategories: Function = (): {
    components: Array<ComponentMetadata>;
    categories: Array<ComponentCategory>;
} => {
    let initComponents: Array<ComponentMetadata> = [];
    const initCategories: Array<ComponentCategory> = [...Categories];

    initComponents = initComponents.concat(Components);

    for (const model of Entities) {
        initComponents = initComponents.concat(
            BaseModelComponentFactory.getComponents(new model())
        );
        initCategories.push({
            name: new model().singularName || 'Model',
            description: `Interact with ${
                new model().singularName
            } in your workflow.`,
            icon: new model().icon || IconProp.Database,
        });
    }

    return { components: initComponents, categories: initCategories };
};

export const componentInputTypeToFormFieldType: Function = (
    componentInputType: ComponentInputType,
    argValue: any
): {
    fieldType: FormFieldSchemaType;
    dropdownOptions?: Array<DropdownOption> | undefined;
} => {
    // first priority.

    if (componentInputType === ComponentInputType.BaseModel) {
        return {
            fieldType: FormFieldSchemaType.JSON,
        };
    }

    if (componentInputType === ComponentInputType.BaseModelArray) {
        return {
            fieldType: FormFieldSchemaType.JSON,
        };
    }

    if (componentInputType === ComponentInputType.JSON) {
        return {
            fieldType: FormFieldSchemaType.JSON,
        };
    }

    if (componentInputType === ComponentInputType.JSONArray) {
        return {
            fieldType: FormFieldSchemaType.JSON,
        };
    }

    if (componentInputType === ComponentInputType.JavaScript) {
        return {
            fieldType: FormFieldSchemaType.JavaScript,
        };
    }

    if (componentInputType === ComponentInputType.Query) {
        return {
            fieldType: FormFieldSchemaType.JSON,
        };
    }

    if (componentInputType === ComponentInputType.Select) {
        return {
            fieldType: FormFieldSchemaType.JSON,
        };
    }

    if (componentInputType === ComponentInputType.StringDictionary) {
        return {
            fieldType: FormFieldSchemaType.JSON,
        };
    }

    if (componentInputType === ComponentInputType.LongText) {
        return {
            fieldType: FormFieldSchemaType.LongText,
        };
    }

    // Second priorioty.

    if (
        argValue &&
        typeof argValue === Typeof.String &&
        argValue.toString().includes('{{')
    ) {
        return {
            fieldType: FormFieldSchemaType.Text,
            dropdownOptions: [],
        };
    }

    if (componentInputType === ComponentInputType.Boolean) {
        return {
            fieldType: FormFieldSchemaType.Toggle,
            dropdownOptions: [],
        };
    }

    if (componentInputType === ComponentInputType.HTML) {
        return {
            fieldType: FormFieldSchemaType.HTML,
            dropdownOptions: [],
        };
    }

    if (componentInputType === ComponentInputType.CronTab) {
        return {
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: [
                {
                    label: 'Every Minute',
                    value: '* * * * *',
                },
                {
                    label: 'Every 30 minutes',
                    value: '*/30 * * * *',
                },
                {
                    label: 'Every Hour',
                    value: '0 * * * *',
                },
                {
                    label: 'Every Day',
                    value: '0 0 * * *',
                },
                {
                    label: 'Every Week',
                    value: '0 0 * * 0',
                },
                {
                    label: 'Every Month',
                    value: '0 0 1 * *',
                },
                {
                    label: 'Every Three Months',
                    value: '0 0 1 */3 *',
                },
                {
                    label: 'Every Six Months',
                    value: '0 0 1 */6 *',
                },
            ],
        };
    }

    if (componentInputType === ComponentInputType.Operator) {
        return {
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: [
                {
                    label: 'Equal To',
                    value: '==',
                },
                {
                    label: 'Not Equal To',
                    value: '!=',
                },
                {
                    label: 'Greater Than',
                    value: '>',
                },
                {
                    label: 'Less Than',
                    value: '<',
                },
                {
                    label: 'Greater Than or Equal',
                    value: '>=',
                },
                {
                    label: 'Less Than or Equal',
                    value: '<=',
                },
            ],
        };
    }

    if (componentInputType === ComponentInputType.Date) {
        return {
            fieldType: FormFieldSchemaType.Date,
        };
    }

    if (componentInputType === ComponentInputType.DateTime) {
        return {
            fieldType: FormFieldSchemaType.DateTime,
        };
    }

    if (componentInputType === ComponentInputType.Decimal) {
        return {
            fieldType: FormFieldSchemaType.Number,
        };
    }

    if (componentInputType === ComponentInputType.Email) {
        return {
            fieldType: FormFieldSchemaType.Email,
        };
    }

    if (componentInputType === ComponentInputType.Number) {
        return {
            fieldType: FormFieldSchemaType.Number,
        };
    }

    if (componentInputType === ComponentInputType.Password) {
        return {
            fieldType: FormFieldSchemaType.Password,
        };
    }

    if (componentInputType === ComponentInputType.URL) {
        return {
            fieldType: FormFieldSchemaType.URL,
        };
    }

    return {
        fieldType: FormFieldSchemaType.Text,
        dropdownOptions: [],
    };
};
