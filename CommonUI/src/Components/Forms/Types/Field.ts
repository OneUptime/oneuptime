import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import FormFieldSchemaType from './FormFieldSchemaType';
import SelectFormFields from './SelectFormField';

export default interface Field<TEntity> {
    title?: string;
    description?: string;
    field: SelectFormFields<TEntity>;
    placeholder?: string;
    required?: boolean;
    sideLink?: {
        text: string;
        url: Route | URL;
        openLinkInNewTab?: boolean;
    };
    fieldType?: FormFieldSchemaType;
}
