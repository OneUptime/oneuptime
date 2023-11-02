import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    title: string;
}

const Section: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="section-label text-gray-500 mt-2 text-md font-medium flex">
            <div className="section-title">{props.title}</div>
            <div className="section-border flex-grow border-t border-gray-300 ml-3 mt-3"></div>
        </div>
    );
};

export default Section;
