import React from 'react';
import Footer from 'CommonUI/src/Components/Footer/Footer';
import URL from 'Common/Types/API/URL';

const DashboardFooter: () => JSX.Element = () => {
    return (
        <Footer
            className="bg-white h-16 inset-x-0 bottom-0 px-8"
            copyright="HackerBay, Inc."
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

export default DashboardFooter;
