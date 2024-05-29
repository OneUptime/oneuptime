import PageComponentProps from '../../../../PageComponentProps';
import ComingSoon from 'CommonUI/src/Components/ComingSoon/ComingSoon';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';

const ServiceDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Fragment>
            <ComingSoon />
        </Fragment>
    );
};

export default ServiceDelete;
