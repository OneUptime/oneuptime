import React, { FunctionComponent } from 'react';
import Footer from 'CommonUI/src/Components/Footer/Footer';

const DashboardFooter: FunctionComponent = () => {
    return (
        <Footer
            left={<p>{new Date().getFullYear()} © OneUptime Limited.</p>}
            right={
                <div className="text-sm-end d-none d-sm-block">
                    Design &amp; Develop by
                    <a
                        className="ms-1 text-decoration-underline"
                        href="/dashboard"
                    >
                        Themesbrand
                    </a>
                </div>
            }
        />
    );
};

export default DashboardFooter;
