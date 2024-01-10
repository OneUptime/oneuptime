import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../../../PageComponentProps';
import ComingSoon from 'CommonUI/src/Components/ComingSoon/ComingSoon';

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
