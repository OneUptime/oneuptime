import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import FormFieldSchemaType from './FormFieldSchemaType';
import SelectFormFields from '../../../Types/SelectEntityField';
import { DropdownOption } from '../../Dropdown/Dropdown';
import { BaseModelType } from 'Common/Models/BaseModel';
import MimeType from 'Common/Types/File/MimeType';
import FormValues from './FormValues';
import { RadioButton } from '../../RadioButtons/GroupRadioButtons';
import { ReactElement } from 'react';
import {
    CategoryCheckboxOption,
    CheckboxCategory,
} from '../../CategoryCheckbox/CategoryCheckboxTypes';

export enum FormFieldStyleType {
    Default = 'Default',
    Heading = 'Heading',
    DividerBelow = 'DividerBelow',
}

export interface FormFieldSideLink {
    text: string;
    url: Route | URL;
    openLinkInNewTab?: boolean;
}

export interface CustomElementProps {
    error?: string | undefined;
    tabIndex?: number | undefined;
    onChange?: ((value: any) => void) | undefined;
    onBlur?: () => void;
    initialValue?: any;
    placeholder?: string | undefined;
}

export interface CategoryCheckboxProps {
    categories: Array<CheckboxCategory>;
    options: Array<CategoryCheckboxOption>;
}

export default interface Field<TEntity> {
    name?: string; // form field name, should be unique in thr form. If not provided, the field will be auto generated.
    title?: string;
    description?: string;
    field?: SelectFormFields<TEntity> | undefined;
    placeholder?: string;
    showEvenIfPermissionDoesNotExist?: boolean; // show this field even if user does not have permissions to view.
    disabled?: boolean;
    stepId?: string | undefined;
    required?: boolean | ((item: FormValues<TEntity>) => boolean) | undefined;
    dropdownOptions?: Array<DropdownOption> | undefined;
    fetchDropdownOptions?: (() => Promise<Array<DropdownOption>>) | undefined;
    dropdownModal?: {
        type: BaseModelType;
        labelField: string;
        valueField: string;
    };
    selectByAccessControlProps?: {
        categoryCheckboxProps: CategoryCheckboxProps;
        accessControlColumnTitle: string;
    };
    fileTypes?: Array<MimeType> | undefined;
    sideLink?: FormFieldSideLink | undefined;
    validation?: {
        minLength?: number | undefined;
        maxLength?: number | undefined;
        toMatchField?: string | undefined;
        noSpaces?: boolean | undefined;
        noSpecialCharacters?: boolean;
        noNumbers?: boolean | undefined;
        minValue?: number | undefined;
        maxValue?: number | undefined;
        dateShouldBeInTheFuture?: boolean | undefined;
    };
    customValidation?:
        | ((values: FormValues<TEntity>) => string | null)
        | undefined;
    styleType?: FormFieldStyleType | undefined;
    showIf?: ((item: FormValues<TEntity>) => boolean) | undefined;
    onChange?: ((value: any) => void) | undefined;
    fieldType?: FormFieldSchemaType;
    overrideFieldKey?: string;
    defaultValue?: boolean | string | Date | undefined;
    radioButtonOptions?: Array<RadioButton>;
    footerElement?: ReactElement | undefined;
    getCustomElement?: (
        values: FormValues<TEntity>,
        props: CustomElementProps
    ) => ReactElement | undefined; // custom element to render instead of the elements in the form.
    categoryCheckboxProps?: CategoryCheckboxProps | undefined; // props for the category checkbox component. If fieldType is CategoryCheckbox, this prop is required.
}
