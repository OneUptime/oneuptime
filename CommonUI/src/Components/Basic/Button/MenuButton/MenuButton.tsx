import React, { ReactElement, FunctionComponent } from 'react';
import './MenuButton.scss';
import Button from '../Button';
import useComponentOutsideClick from '../../../../Types/UseComponentOutsideClick';
import CSS from 'csstype';
import { IconProp, SizeProp } from '../../Icon/Icon';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    title: string;
    style?: CSS.Properties;
}

const MenuButton: FunctionComponent<ComponentProps> = ({
    title,
    children,
    style,
}: ComponentProps): ReactElement => {
    const { ref, isComponentVisible, setIsComponentVisible } =
        useComponentOutsideClick(false);

    return (
        <div className="dropdownButton" ref={ref}>
            <Button
                title={title}
                onClick={() => {
                    setIsComponentVisible(true);
                }}
                style={style ? style : {}}
                icon={IconProp.ChevronDown}
                showIconOnRight={true}
                iconSize={SizeProp.Small}
            />

            {isComponentVisible && (
                <div className="dropdownButtonLists">{children}</div>
            )}
        </div>
    );
};

export default MenuButton;
