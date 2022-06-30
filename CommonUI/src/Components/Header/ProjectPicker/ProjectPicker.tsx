import Color from 'Common/Types/Color';
import React, { FunctionComponent, ReactElement } from 'react';
import useComponentOutsideClick from '../../../Types/UseComponentOutsideClick';
import CircularIconImage from '../../Icon/CircularIconImage';
import Icon, { IconProp } from '../../Icon/Icon';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    icon: IconProp;
    title: string;
}

const ProjectPicker: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const { ref, isComponentVisible, setIsComponentVisible } =
        useComponentOutsideClick(false);

    return (
        <div className="d-inline-block dropdown">
            <button
                onClick={() => {
                    setIsComponentVisible(!isComponentVisible);
                }}
                id="page-header-user-dropdown"
                aria-haspopup="true"
                className="btn header-item flex items-center pr-30"
                aria-expanded="false"
            >
                <CircularIconImage
                    icon={props.icon}
                    iconColor={new Color('#000')}
                    backgroundColor={new Color('#fff')}
                />
                <h6 className="mb-0">{props.title}</h6>
                <Icon icon={IconProp.ChevronDown} />
            </button>
            <div ref={ref}>{isComponentVisible && props.children}</div>
        </div>
    );
};

export default ProjectPicker;
