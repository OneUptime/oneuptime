import React, { FunctionComponent, ReactElement } from 'react';
import { Green500, Red500 } from 'Common/Types/BrandColors';
import IconProp from 'Common/Types/Icon/IconProp';
import Icon from '../Icon/Icon';

export interface ComponentProps {
    text: string;
    isChecked: boolean;
}

const CheckboxViewer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div>
            <div className="flex">
                <div className="h-6 w-6">
                    {props.isChecked ? (
                        <Icon
                            className="h-5 w-5"
                            icon={IconProp.CheckCircle}
                            color={Green500}
                        />
                    ) : (
                        <Icon
                            className="h-5 w-5"
                            icon={IconProp.CircleClose}
                            color={Red500}
                        />
                    )}
                </div>
                <div className="text-sm text-gray-900 flex justify-left">
                    {props.text}
                </div>
            </div>
        </div>
    );
};

export default CheckboxViewer;
