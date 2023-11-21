import React, { FunctionComponent, ReactElement } from 'react';
import EmptyState from '../EmptyState/EmptyState';
import IconProp from 'Common/Types/Icon/IconProp';

const ComingSoon: FunctionComponent = (): ReactElement => {
    return (
        <EmptyState
            id="coming-soon"
            icon={IconProp.CursorArrowRays}
            title="Coming soon!"
            description="We will be launching this feature very soon. Stay Tuned!"
        />
    );
};

export default ComingSoon;
