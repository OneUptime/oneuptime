import { JSONObject } from 'Common/Types/JSON';
import { ButtonStyleType } from '../Button/Button';

import IconProp from 'Common/Types/Icon/IconProp';

interface ActionButtonSchema {
    title: string;
    icon?: undefined | IconProp;
    buttonStyleType: ButtonStyleType;
    isLoading?: boolean | undefined;
    isVisible?: (item: JSONObject) => boolean | undefined;
    onClick: (
        item: JSONObject,
        onCompleteAction: () => void,
        onError: (err: Error) => void
    ) => void;
}

export default ActionButtonSchema;
