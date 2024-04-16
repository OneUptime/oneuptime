import IconProp from 'Common/Types/Icon/IconProp';
import { ButtonStyleType } from '../../Button/Button';
import { CardButtonSchema } from '../Card';

type GetButtonFunctionType = () => CardButtonSchema;

export const getRefreshButton: GetButtonFunctionType = (): CardButtonSchema => {
    return {
        title: '',
        buttonStyle: ButtonStyleType.ICON,
        onClick: () => {},
        disabled: false,
        icon: IconProp.Refresh,
    };
};
