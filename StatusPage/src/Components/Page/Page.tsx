import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    children?: Array<ReactElement> | ReactElement | undefined;
}

const Page: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div
            
        >
            {props.children && props.children}
        </div>
    );
};

export default Page;
