import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    header: ReactElement | undefined;
    navbar: ReactElement | undefined;
    className?: string | undefined;
    hideHeader?: boolean | undefined;
}

const TopSection: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <header className={props.className || 'bg-white shadow'}>
            <div className="w-full px-2 sm:px-4 lg:divide-y lg:divide-gray-200 lg:px-8">
                {!props.hideHeader && props.header}
                {props.navbar}
            </div>
        </header>
    );
};

export default TopSection;
