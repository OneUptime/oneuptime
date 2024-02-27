import { JSONObject } from 'Common/Types/JSON';
import { ButtonStyleType } from '../Button/Button';

import IconProp from 'Common/Types/Icon/IconProp';
import { ErrorFunctionType, VoidFunctionType } from 'Common/Types/FunctionTypes';

interface ActionButtonSchema {
    title: string;
    icon?: undefined | IconProp;
    buttonStyleType: ButtonStyleType;
    isLoading?: boolean | undefined;
    isVisible?: (item: JSONObject) => boolean | undefined;
    onClick: (
        item: JSONObject,
        onCompleteAction: VoidFunctionType,
        onError: ErrorFunctionType
    ) => void;
}

export default ActionButtonSchema;
