import { ButtonStyleType } from '../Button/Button';
import { ErrorFunction, VoidFunction } from 'Common/Types/FunctionTypes';
import GenericObject from 'Common/Types/GenericObject';
import IconProp from 'Common/Types/Icon/IconProp';

interface ActionButtonSchema<T extends GenericObject> {
    title: string;
    icon?: undefined | IconProp;
    buttonStyleType: ButtonStyleType;
    isLoading?: boolean | undefined;
    isVisible?: (item: T) => boolean | undefined;
    onClick: (
        item: T,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction
    ) => void;
}

export default ActionButtonSchema;
