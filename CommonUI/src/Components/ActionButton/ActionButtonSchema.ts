import type { JSONObject } from 'Common/Types/JSON';
import type { ButtonStyleType } from '../Button/Button';
import type { IconProp } from '../Icon/Icon';

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
