import { JSONObject } from 'Common/Types/JSON';
import { ButtonStyleType } from '../Button/Button';

import IconProp from 'Common/Types/Icon/IconProp';
import {
    ErrorFunction,
    VoidFunction,
} from 'Common/Types/FunctionsTypes';

interface ActionButtonSchema {
    title: string;
    icon?: undefined | IconProp;
    buttonStyleType: ButtonStyleType;
    isLoading?: boolean | undefined;
    isVisible?: (item: JSONObject) => boolean | undefined;
    onClick: (
        item: JSONObject,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction
    ) => void;
}

export default ActionButtonSchema;
