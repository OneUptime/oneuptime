import type Route from 'Common/Types/API/Route';
import type URL from 'Common/Types/API/URL';
import type FormFieldSchemaType from './FormFieldSchemaType';
import type SelectFormFields from '../../../Types/SelectEntityField';
import type { DropdownOption } from '../../Dropdown/Dropdown';
import type BaseModel from 'Common/Models/BaseModel';
import type MimeType from 'Common/Types/File/MimeType';
import type FormValues from './FormValues';
import type { RadioButton } from '../../RadioButtons/RadioButtons';
import type { ReactElement } from 'react';

export default interface Field<TEntity> {
    title?: string;
    description?: string;
    field: SelectFormFields<TEntity>;
    placeholder?: string;
    forceShow?: boolean; // show this field even if user does not have permissions to view.
    disabled?: boolean;
    required?: boolean;
    dropdownOptions?: Array<DropdownOption> | undefined;
    dropdownModal?: {
        type: { new (): BaseModel };
        labelField: string;
        valueField: string;
    };
    fileTypes?: Array<MimeType> | undefined;
    sideLink?: {
        text: string;
        url: Route | URL;
        openLinkInNewTab?: boolean;
    };
    validation?: {
        minLength?: number;
        maxLength?: number;
        toMatchField?: string;
        noSpaces?: boolean;
        minValue?: number;
        maxValue?: number;
        dateShouldBeInTheFuture?: boolean;
    };
    showIf?: ((item: FormValues<TEntity>) => boolean) | undefined;
    onChange?: ((value: any, form: any) => void) | undefined;
    fieldType?: FormFieldSchemaType;
    overideFieldKey?: string;
    defaultValue?: boolean | string | undefined;
    radioButtonOptions?: Array<RadioButton>;
    footerElement?: ReactElement | undefined;
}
