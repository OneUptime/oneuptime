import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import type { ComponentProps as PageComponentProps } from 'CommonUI/src/Components/Page/Page';
import Page from 'CommonUI/src/Components/Page/Page';

const StausPagePage: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page {...props} className="mx-auto max-w-full mt-5 mb-20 h-full p-0" />
    );
};

export default StausPagePage;
