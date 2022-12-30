import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    children?: Array<ReactElement> | ReactElement | undefined;
}

const Page: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div
            className="page-content"
            style={{
                marginLeft: '0px',
                paddingLeft: '5px',
                marginTop: '0px',
                width: '100%',
            }}
        >
            {props.children && props.children}
        </div>
    );
};

export default Page;
