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
import DockerImage from '../Images/SvgImages/docker.svg';
import SyslogImage from '../Images/SvgImages/syslog.svg';
import PostgresSQLImage from '../Images/SvgImages/postgres.svg';
import MySQLImage from '../Images/SvgImages/mysql.svg';
import SystemdImage from '../Images/SvgImages/systemd.svg';
import MoreSourcesImage from '../Images/SvgImages/moresources.svg';
import Card from 'CommonUI/src/Components/Card/Card';
import Route from 'Common/Types/API/Route';

const TelemetryDocumentation: FunctionComponent = (): ReactElement => {
    const openTelemetryDocUrl: Route = Route.fromString(
        '/docs/telemetry/open-telemetry'
    );

    const fluentdDocUrl: Route = Route.fromString('/docs/telemetry/fluentd');

    return (
        <Card
            title={'Documentation'}
            description={
                'Learn how to integrate OneUptime with your application or resources to collect logs, metrics and traces data.'
            }
        >
            <ImageTiles
                title="Integrate with OpenTelemetry"
                description="OneUptime supports a native integration with OpenTelemetry. OpenTelemetry is a collection of tools, APIs, and SDKs used to instrument, generate, collect, and export telemetry data (metrics, logs, and traces) for analysis in order to understand your software performance and behavior."
                tiles={[
                    {
                        image: JavaScriptImage,
                        navigateToUrl: openTelemetryDocUrl,
                        title: 'JavaScript',
                    },
                    {
                        image: TypeScriptImage,
                        navigateToUrl: openTelemetryDocUrl,
                        title: 'TypeScript',
                    },
                    {
                        image: ReactImage,
                        navigateToUrl: openTelemetryDocUrl,
                        title: 'React',
                    },
                    {
                        image: NodeImage,
                        navigateToUrl: openTelemetryDocUrl,
                        title: 'Node',
                    },
                    {
                        image: RustImage,
                        navigateToUrl: openTelemetryDocUrl,
                        title: 'Rust',
                    },
                    {
                        image: GoImage,
                        navigateToUrl: openTelemetryDocUrl,
                        title: 'Go',
                    },
                    {
                        image: PythonImage,
                        navigateToUrl: openTelemetryDocUrl,
                        title: 'Python',
                    },
                    {
                        image: JavaImage,
                        navigateToUrl: openTelemetryDocUrl,
                        title: 'Java',
                    },
                    {
                        image: CSharpImage,
                        navigateToUrl: openTelemetryDocUrl,
                        title: 'C#',
                    },
                ]}
            />

            <ImageTiles
                title="Integrate with Fluentd"
                description="OneUptime supports a native integration with Fluentd. Fluentd is an open source data collector for unified logging layer. Fluentd allows you to unify data collection and consumption for a better use and understanding of data."
                tiles={[
                    {
                        image: DockerImage,
                        navigateToUrl: fluentdDocUrl,
                        title: 'Docker',
                    },
                    {
                        image: SyslogImage,
                        navigateToUrl: fluentdDocUrl,
                        title: 'Syslog',
                    },
                    {
                        image: PostgresSQLImage,
                        navigateToUrl: fluentdDocUrl,
                        title: 'PostgresSQL',
                    },
                    {
                        image: MySQLImage,
                        navigateToUrl: fluentdDocUrl,
                        title: 'MySQL',
                    },
                    {
                        image: SystemdImage,
                        navigateToUrl: fluentdDocUrl,
                        title: 'Systemd',
                    },
                    {
                        image: MoreSourcesImage,
                        navigateToUrl: fluentdDocUrl,
                        title: '+ 1000 more sources',
                    },
                ]}
            />
        </Card>
    );
};

export default TelemetryDocumentation;
