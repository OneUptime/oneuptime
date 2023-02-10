import Color from 'Common/Types/Color';
import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { SizeProp } from './Icon';
import IconProp from 'Common/Types/Icon/IconProp';

export interface ComponentProps {
    backgroundColor?: undefined | Color;
    icon: IconProp;
    iconColor?: undefined | Color;
}

const CircularIconImage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div
            className="me-3 rounded-circle avatar-sm shadow-md"
            style={{
                textAlign: 'center',
                paddingTop: '3px',
                backgroundColor: props.backgroundColor
                    ? props.backgroundColor.toString()
                    : 'black',
            }}
        >
            <Icon
                icon={props.icon}
                size={SizeProp.Large}
                color={props.iconColor ? props.iconColor : new Color('#ffffff')}
            />
        </div>
    );
};

export default CircularIconImage;
