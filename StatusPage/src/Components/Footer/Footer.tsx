import React, { FunctionComponent } from 'react';
import Footer from 'CommonUI/src/Components/Footer/Footer';
import URL from 'Common/Types/API/URL';

const StatusPageFooter: FunctionComponent = () => {
    return (
        <Footer
            copyright="OneUptime Limited."
            links={[
                {
                    title: 'Help and Support',
                    to: URL.fromString('https://oneuptime.com/support'),
                },
                {
                    title: 'Legal',
                    to: URL.fromString('https://oneuptime.com/legal'),
                },
            ]}
        />
    );
};

export default StatusPageFooter;
