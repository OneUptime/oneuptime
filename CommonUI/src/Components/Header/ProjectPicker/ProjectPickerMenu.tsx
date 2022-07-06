import React, { FunctionComponent, ReactElement } from 'react';
import ProjectPickerFilterBox from './ProjectPickerFilterBox';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    onFilter: (value: string) => void;
}

const ProjectPickerMenu: FunctionComponent<ComponentProps> = (
    props: ComponentProps

): ReactElement => {
    return (
        <div
            tabIndex={-1}
            role="menu"
            aria-hidden="true"
            className="dropdown-menu dropdown-menu-md show"
            style={{
                position: 'absolute',
                willChange: 'transform',
                top: '0px',
                left: '0px',
                transform: 'translate3d(0px, 70px, 0px)',
            }}
        >
            <ProjectPickerFilterBox key={2} onChange={(value: string) => { props.onFilter(value) }} />
            <div className=" dropdown-menu-scroll">{props.children}</div>
        </div>
    );
};

export default ProjectPickerMenu;
