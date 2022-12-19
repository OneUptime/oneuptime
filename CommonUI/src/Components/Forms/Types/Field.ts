import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import FormFieldSchemaType from './FormFieldSchemaType';
import SelectFormFields from '../../../Types/SelectEntityField';
import { DropdownOption } from '../../Dropdown/Dropdown';
import BaseModel from 'Common/Models/BaseModel';
import MimeType from 'Common/Types/File/MimeType';
import FormValues from './FormValues';
import { RadioButton } from '../../RadioButtons/RadioButtons';
import { ReactElement } from 'react';

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
