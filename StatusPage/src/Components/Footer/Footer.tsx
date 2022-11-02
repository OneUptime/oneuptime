import React, { FunctionComponent, ReactElement } from 'react';
import Footer from 'CommonUI/src/Components/Footer/Footer';
import URL from 'Common/Types/API/URL';
import Link from 'Common/Types/Link';

export interface ComponentProps {
    copyright?: string | undefined;
    links: Array<Link>;
}

const StatusPageFooter: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Footer
            copyright={props.copyright}
            style={{
                maxWidth: '880px',
                paddingLeft: '0px',
                paddingRight: '0px',
            }}
            links={[
                ...props.links,
                {
                    title: 'Powered by OneUptime',
                    to: URL.fromString('https://oneuptime.com'),
                    openInNewTab: true,
                    showOnRightIfNoCopyright: true,
                },
            ]}
        />
    );
};

export default StatusPageFooter;
