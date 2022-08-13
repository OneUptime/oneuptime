import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import FieldType from '../Types/FieldType';

export default interface Field {
    title?: string;
    description?: string;
    key: string;
    fieldType?: FieldType;
    sideLink?: {
        text: string;
        url: Route | URL;
        openLinkInNewTab?: boolean;
    };
    opts?:
        | {
              isCopyable?: boolean | undefined;
          }
        | undefined;
}
