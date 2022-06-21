import Color from 'Common/Types/Color';
import React, { ReactElement } from 'react';
import Icon, { IconProp, SizeProp } from './Icon';

export interface ComponentProps {
    backgroundColor?: Color;
    icon: IconProp;
    iconColor?: Color;
}

const CircularIconImage = (props: ComponentProps): ReactElement => {
    return (
        <div
            className="me-3 rounded-circle avatar-sm"
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
