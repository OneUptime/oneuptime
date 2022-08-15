import { JSONObject } from 'Common/Types/JSON';
import { ButtonStyleType } from '../../Button/Button';
import { IconProp } from '../../Icon/Icon';

interface ActionButtonSchema {
    title: string;
    icon?: undefined | IconProp;
    buttonStyleType: ButtonStyleType;
    isLoading?: boolean | undefined
    onClick: ((item: JSONObject, onCompleteAction: ()=> void, onError: (err: Error)=> void) => void);
}

export default ActionButtonSchema;
