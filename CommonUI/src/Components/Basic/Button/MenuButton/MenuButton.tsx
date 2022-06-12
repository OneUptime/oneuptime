import React, { ReactElement, FunctionComponent } from 'react';
import './MenuButton.scss';
import Button from '../Button';
import useComponentOutsideClick from '../../../../Types/UseComponentOutsideClick';

export interface ComponentProps {
    children?: ReactElement | Array<ReactElement>;
    title: string;
}

const MenuButton: FunctionComponent<ComponentProps> = ({
    title,
    children,
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
            />

            {isComponentVisible && (
                <div className="dropdownButtonLists">{children}</div>
            )}
        </div>
    );
};

export default MenuButton;
