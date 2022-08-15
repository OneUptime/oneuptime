import { JSONObject } from 'Common/Types/JSON';
import { ButtonStyleType } from '../../Button/Button';
import { IconProp } from '../../Icon/Icon';

interface ActionButtonSchema {
    title: string;
    icon?: undefined | IconProp;
    buttonStyleType: ButtonStyleType;
    onClick: ((item: JSONObject) => void);
}

export default ActionButtonSchema;
