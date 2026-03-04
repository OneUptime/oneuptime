import CSharpImage from "../Images/SvgImages/csharp.svg";
import DockerImage from "../Images/SvgImages/docker.svg";
import GoImage from "../Images/SvgImages/go.svg";
import JavaImage from "../Images/SvgImages/java.svg";
import JavaScriptImage from "../Images/SvgImages/javascript.svg";
import MoreSourcesImage from "../Images/SvgImages/moresources.svg";
import MySQLImage from "../Images/SvgImages/mysql.svg";
import NodeImage from "../Images/SvgImages/node.svg";
import PostgresSQLImage from "../Images/SvgImages/postgres.svg";
import PythonImage from "../Images/SvgImages/python.svg";
import ReactImage from "../Images/SvgImages/react.svg";
import RustImage from "../Images/SvgImages/rust.svg";
import SyslogImage from "../Images/SvgImages/syslog.svg";
import SystemdImage from "../Images/SvgImages/systemd.svg";
import TypeScriptImage from "../Images/SvgImages/typescript.svg";
import Route from "Common/Types/API/Route";
import Card from "Common/UI/Components/Card/Card";
import ImageTiles from "Common/UI/Components/ImageTiles/ImageTiles";
import React, { FunctionComponent, ReactElement } from "react";

const TelemetryDocumentation: FunctionComponent = (): ReactElement => {
  const openTelemetryDocUrl: Route = Route.fromString(
    "/docs/telemetry/open-telemetry",
  );

  const fluentdDocUrl: Route = Route.fromString("/docs/telemetry/fluentd");

  const fluentBitDocUrl: Route = Route.fromString("/docs/telemetry/fluentbit");

  const syslogDocUrl: Route = Route.fromString("/docs/telemetry/syslog");

  return (
    <Card
      title={"Documentation"}
      description={
        "Learn how to integrate OneUptime with your application or resources to collect logs, metrics and traces data."
      }
    >
      <ImageTiles
        title="Integrate with OpenTelemetry"
        description="OneUptime supports a native integration with OpenTelemetry. OpenTelemetry is a collection of tools, APIs, and SDKs used to instrument, generate, collect, and export telemetry data (metrics, logs, and traces) for analysis in order to understand your software performance and behavior."
        tiles={[
          {
            image: JavaScriptImage,
            navigateToUrl: openTelemetryDocUrl,
            title: "JavaScript",
          },
          {
            image: TypeScriptImage,
            navigateToUrl: openTelemetryDocUrl,
            title: "TypeScript",
          },
          {
            image: ReactImage,
            navigateToUrl: openTelemetryDocUrl,
            title: "React",
          },
          {
            image: NodeImage,
            navigateToUrl: openTelemetryDocUrl,
            title: "Node",
          },
          {
            image: RustImage,
            navigateToUrl: openTelemetryDocUrl,
            title: "Rust",
          },
          {
            image: GoImage,
            navigateToUrl: openTelemetryDocUrl,
            title: "Go",
          },
          {
            image: PythonImage,
            navigateToUrl: openTelemetryDocUrl,
            title: "Python",
          },
          {
            image: JavaImage,
            navigateToUrl: openTelemetryDocUrl,
            title: "Java",
          },
          {
            image: CSharpImage,
            navigateToUrl: openTelemetryDocUrl,
            title: "C#",
          },
        ]}
      />

      <ImageTiles
        title="Send Native Syslog"
        description="Forward RFC3164 or RFC5424 Syslog payloads directly to OneUptime over HTTPS without additional collectors."
        tiles={[
          {
            image: SyslogImage,
            navigateToUrl: syslogDocUrl,
            title: "Syslog",
          },
        ]}
      />

      <ImageTiles
        title="Integrate with Fluentd"
        description="OneUptime supports a native integration with Fluentd. Fluentd is an open-source data collector for unified logging layer. Fluentd allows you to unify data collection and consumption for a better use and understanding of data."
        tiles={[
          {
            image: DockerImage,
            navigateToUrl: fluentdDocUrl,
            title: "Docker",
          },
          {
            image: SyslogImage,
            navigateToUrl: fluentdDocUrl,
            title: "Syslog",
          },
          {
            image: PostgresSQLImage,
            navigateToUrl: fluentdDocUrl,
            title: "PostgresSQL",
          },
          {
            image: MySQLImage,
            navigateToUrl: fluentdDocUrl,
            title: "MySQL",
          },
          {
            image: SystemdImage,
            navigateToUrl: fluentdDocUrl,
            title: "Systemd",
          },
          {
            image: MoreSourcesImage,
            navigateToUrl: fluentdDocUrl,
            title: "+ 1000 more sources",
          },
        ]}
      />

      <ImageTiles
        title="Integrate with FluentBit"
        description="OneUptime supports a native integration with FluentBit. FluentBit is an open-source data collector for unified logging and telemetry layer. FluentBit allows you to unify data collection and consumption for a better use and understanding of data."
        tiles={[
          {
            image: DockerImage,
            navigateToUrl: fluentBitDocUrl,
            title: "Docker",
          },
          {
            image: SyslogImage,
            navigateToUrl: fluentBitDocUrl,
            title: "Syslog",
          },
          {
            image: PostgresSQLImage,
            navigateToUrl: fluentBitDocUrl,
            title: "PostgresSQL",
          },
          {
            image: MySQLImage,
            navigateToUrl: fluentBitDocUrl,
            title: "MySQL",
          },
          {
            image: SystemdImage,
            navigateToUrl: fluentBitDocUrl,
            title: "Systemd",
          },
          {
            image: MoreSourcesImage,
            navigateToUrl: fluentBitDocUrl,
            title: "+ 1000 more sources",
          },
        ]}
      />
    </Card>
  );
};

export default TelemetryDocumentation;
