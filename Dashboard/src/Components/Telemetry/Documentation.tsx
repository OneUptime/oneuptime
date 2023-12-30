import React, { FunctionComponent, ReactElement } from 'react';
import ImageTiles from 'CommonUI/src/Components/ImageTiles/ImageTiles';
import JavaScriptImage from '../Images/SvgImages/javascript.svg';
import TypeScriptImage from '../Images/SvgImages/typescript.svg';
import ReactImage from '../Images/SvgImages/react.svg';
import NodeImage from '../Images/SvgImages/node.svg';
import RustImage from '../Images/SvgImages/rust.svg';
import GoImage from '../Images/SvgImages/go.svg';
import PythonImage from '../Images/SvgImages/python.svg';
import JavaImage from '../Images/SvgImages/java.svg';
import CSharpImage from '../Images/SvgImages/csharp.svg';

import URL from 'Common/Types/API/URL';
import Card from 'CommonUI/src/Components/Card/Card';

const TelemetryDocumentation: FunctionComponent = (): ReactElement => {
    const docUrl: URL = URL.fromString(
        'https://github.com/OneUptime/oneuptime/tree/master/Docs/Telemetry/OpenTelemetry'
    );

    return (
        <Card
            title={'Documentation'}
            description={
                'Learn how to integrate OneUptime with your application or resources to collect logs, metriics and traces data.'
            }
        >
            <ImageTiles
                title="Integrate with OpenTelemetry"
                description="OneUptime supports a native integration with OpenTelemetry. OpenTelemetry is a collection of tools, APIs, and SDKs used to instrument, generate, collect, and export telemetry data (metrics, logs, and traces) for analysis in order to understand your software performance and behavior."
                tiles={[
                    {
                        image: JavaScriptImage,
                        navigateToUrl: docUrl,
                        title: 'JavaScript',
                    },
                    {
                        image: TypeScriptImage,
                        navigateToUrl: docUrl,
                        title: 'TypeScript',
                    },
                    {
                        image: ReactImage,
                        navigateToUrl: docUrl,
                        title: 'React',
                    },
                    {
                        image: NodeImage,
                        navigateToUrl: docUrl,
                        title: 'Node',
                    },
                    {
                        image: RustImage,
                        navigateToUrl: docUrl,
                        title: 'Rust',
                    },
                    {
                        image: GoImage,
                        navigateToUrl: docUrl,
                        title: 'Go',
                    },
                    {
                        image: PythonImage,
                        navigateToUrl: docUrl,
                        title: 'Python',
                    },
                    {
                        image: JavaImage,
                        navigateToUrl: docUrl,
                        title: 'Java',
                    },
                    {
                        image: CSharpImage,
                        navigateToUrl: docUrl,
                        title: 'C#',
                    },
                ]}
            />
        </Card>
    );
};

export default TelemetryDocumentation;
