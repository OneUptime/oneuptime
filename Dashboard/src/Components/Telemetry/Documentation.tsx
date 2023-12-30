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


const TelemetryDocumentation: FunctionComponent = (

): ReactElement => {

    const docUrl: URL = URL.fromString("https://github.com/OneUptime/oneuptime/tree/master/Docs/Telemetry/OpenTelemetry");

    return (
        <ImageTiles
            tiles={[
                {
                    image: JavaScriptImage,
                    navigateToUrl: docUrl
                },
                {
                    image: TypeScriptImage,
                    navigateToUrl: docUrl
                },
                {
                    image: ReactImage,
                    navigateToUrl: docUrl
                },
                {
                    image: NodeImage,
                    navigateToUrl: docUrl
                },
                {
                    image: RustImage,
                    navigateToUrl: docUrl
                },
                {
                    image: GoImage,
                    navigateToUrl: docUrl
                },
                {
                    image: PythonImage,
                    navigateToUrl: docUrl
                },
                {
                    image: JavaImage,
                    navigateToUrl: docUrl
                },
                {
                    image: CSharpImage,
                    navigateToUrl: docUrl
                },

            ]}
        />
    );
};

export default TelemetryDocumentation;
