import React, { FunctionComponent, ReactElement } from 'react';
import Footer from 'CommonUI/src/Components/Footer/Footer';
import URL from 'Common/Types/API/URL';
import Link from 'Common/Types/Link';

export interface ComponentProps {
    copyright?: string | undefined;
    links: Array<Link>;
    className?: string | undefined;
}

const StatusPageFooter: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Footer
            className={props.className}
            copyright={props.copyright}
            links={[
                ...props.links,
                {
                    title: 'Powered by OneUptime.',
                    to: URL.fromString('https://oneuptime.com'),
                    openInNewTab: true,
                },
            ]}
        />
    );
};

export default StatusPageFooter;
