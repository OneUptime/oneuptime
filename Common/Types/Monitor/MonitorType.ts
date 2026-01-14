import BadDataException from "../Exception/BadDataException";
import IconProp from "../Icon/IconProp";

enum MonitorType {
  Manual = "Manual",
  Website = "Website",
  API = "API",
  Ping = "Ping",
  Kubernetes = "Kubernetes",
  IP = "IP",
  IncomingRequest = "Incoming Request",
  IncomingEmail = "Incoming Email",
  Port = "Port",
  Server = "Server",
  SSLCertificate = "SSL Certificate",

  // These two monitor types are same but we are keeping them separate for now - this is for marketing purposes
  SyntheticMonitor = "Synthetic Monitor",
  CustomJavaScriptCode = "Custom JavaScript Code",

  // Telemetry monitor types
  Logs = "Logs",
  Metrics = "Metrics",
  Traces = "Traces",
  Exceptions = "Exceptions",
}

export default MonitorType;

export interface MonitorTypeProps {
  monitorType: MonitorType;
  description: string;
  title: string;
  icon: IconProp;
}

export class MonitorTypeHelper {
  public static isTelemetryMonitor(monitorType: MonitorType): boolean {
    return (
      monitorType === MonitorType.Logs ||
      monitorType === MonitorType.Metrics ||
      monitorType === MonitorType.Traces ||
      monitorType === MonitorType.Exceptions
    );
  }

  public static isManualMonitor(monitorType: MonitorType): boolean {
    return monitorType === MonitorType.Manual;
  }

  public static getAllMonitorTypeProps(): Array<MonitorTypeProps> {
    const monitorTypeProps: Array<MonitorTypeProps> = [
      {
        monitorType: MonitorType.API,
        title: "API",
        description:
          "This monitor type lets you monitor any API - GET, POST, PUT, DELETE or more.",
        icon: IconProp.Code,
      },
      {
        monitorType: MonitorType.Manual,
        title: "Manual",
        description:
          "This monitor is a static monitor and will not actually monitor anything. It will however help you to integrate OneUptime with external monitoring tools and utilities.",
        icon: IconProp.EmptyCircle,
      },
      {
        monitorType: MonitorType.Website,
        title: "Website",
        description:
          "This monitor type lets you monitor landing pages like home page of your company / blog or more.",
        icon: IconProp.Globe,
      },
      {
        monitorType: MonitorType.Ping,
        title: "Ping",
        description:
          "This monitor type does the basic ping test of an endpoint.",
        icon: IconProp.Signal,
      },
      /*
       * {
       *     monitorType: MonitorType.Kubernetes,
       *     title: 'Kubernetes',
       *     description:
       *         'This monitor types lets you monitor Kubernetes clusters.',
       *     icon: IconProp.Cube,
       * },
       */
      {
        monitorType: MonitorType.IP,
        title: "IP",
        description:
          "This monitor type lets you monitor any IPv4 or IPv6 addresses.",
        icon: IconProp.AltGlobe,
      },
      {
        monitorType: MonitorType.IncomingRequest,
        title: "Incoming Request",
        description:
          "This monitor type lets you ping OneUptime from any external device or service with a custom payload.",
        icon: IconProp.Webhook,
      },
      {
        monitorType: MonitorType.IncomingEmail,
        title: "Incoming Email",
        description:
          "This monitor type triggers alerts when emails are received at a unique email address with matching criteria.",
        icon: IconProp.Email,
      },
      {
        monitorType: MonitorType.Port,
        title: "Port",
        description: "This monitor type lets you monitor any TCP or UDP port.",
        icon: IconProp.Terminal,
      },
      {
        monitorType: MonitorType.Server,
        title: "Server / VM",
        description:
          "This monitor type lets you monitor any server, VM, or any machine.",
        icon: IconProp.Database,
      },
      {
        monitorType: MonitorType.SSLCertificate,
        title: "SSL Certificate",
        description:
          "This monitor type lets you monitor SSL certificates of any domain.",
        icon: IconProp.ShieldCheck,
      },
      {
        monitorType: MonitorType.SyntheticMonitor,
        title: "Synthetic Monitor",
        description:
          "This monitor type lets you monitor your web application UI.",
        icon: IconProp.Window,
      },
      {
        monitorType: MonitorType.CustomJavaScriptCode,
        title: "Custom JavaScript Code",
        description:
          "This monitor type lets you run custom JavaScript code on a schedule.",
        icon: IconProp.Code,
      },
      {
        monitorType: MonitorType.Logs,
        title: "Logs",
        description: "This monitor type lets you monitor logs from any source.",
        icon: IconProp.Logs,
      },
      {
        monitorType: MonitorType.Exceptions,
        title: "Exceptions",
        description:
          "This monitor type lets you monitor exceptions and error groups from any source.",
        icon: IconProp.Bug,
      },
      {
        monitorType: MonitorType.Traces,
        title: "Traces",
        description:
          "This monitor type lets you monitor traces from any source.",
        icon: IconProp.Waterfall,
      },
      {
        monitorType: MonitorType.Metrics,
        title: "Metrics",
        description:
          "This monitor type lets you monitor metrics from any source.",
        icon: IconProp.Heartbeat,
      },
    ];

    return monitorTypeProps;
  }

  public static getDescription(monitorType: MonitorType): string {
    const monitorTypeProps: Array<MonitorTypeProps> =
      this.getAllMonitorTypeProps().filter((item: MonitorTypeProps) => {
        return item.monitorType === monitorType;
      });

    if (!monitorTypeProps[0]) {
      throw new BadDataException(
        `${monitorType} does not have monitorType props`,
      );
    }

    return monitorTypeProps[0].description;
  }

  public static getTitle(monitorType: MonitorType): string {
    const monitorTypeProps: Array<MonitorTypeProps> =
      this.getAllMonitorTypeProps().filter((item: MonitorTypeProps) => {
        return item.monitorType === monitorType;
      });

    if (!monitorTypeProps[0]) {
      throw new BadDataException(
        `${monitorType} does not have monitorType props`,
      );
    }

    return monitorTypeProps[0].title;
  }

  public static isProbableMonitor(monitorType: MonitorType): boolean {
    const isProbeableMonitor: boolean =
      monitorType === MonitorType.API ||
      monitorType === MonitorType.Website ||
      monitorType === MonitorType.IP ||
      monitorType === MonitorType.Ping ||
      monitorType === MonitorType.Port ||
      monitorType === MonitorType.SSLCertificate ||
      monitorType === MonitorType.SyntheticMonitor ||
      monitorType === MonitorType.CustomJavaScriptCode;
    return isProbeableMonitor;
  }

  public static getActiveMonitorTypes(): Array<MonitorType> {
    return [
      MonitorType.API,
      MonitorType.Website,
      MonitorType.IP,
      MonitorType.Ping,
      MonitorType.Port,
      MonitorType.SSLCertificate,
      MonitorType.SyntheticMonitor,
      MonitorType.CustomJavaScriptCode,
      MonitorType.IncomingRequest,
      MonitorType.IncomingEmail,
      MonitorType.Server,
      MonitorType.Logs,
      MonitorType.Metrics,
      MonitorType.Traces,
      MonitorType.Exceptions,
    ];
  }

  public static doesMonitorTypeHaveDocumentation(
    monitorType: MonitorType,
  ): boolean {
    return (
      monitorType === MonitorType.IncomingRequest ||
      monitorType === MonitorType.IncomingEmail ||
      monitorType === MonitorType.Server
    );
  }

  public static doesMonitorTypeHaveInterval(monitorType: MonitorType): boolean {
    return this.isProbableMonitor(monitorType);
  }

  public static doesMonitorTypeHaveCriteria(monitorType: MonitorType): boolean {
    return monitorType !== MonitorType.Manual;
  }

  public static doesMonitorTypeHaveGraphs(monitorType: MonitorType): boolean {
    if (
      monitorType === MonitorType.Website ||
      monitorType === MonitorType.API ||
      monitorType === MonitorType.IP ||
      monitorType === MonitorType.Ping ||
      monitorType === MonitorType.Port ||
      monitorType === MonitorType.Server ||
      monitorType === MonitorType.SSLCertificate ||
      monitorType === MonitorType.SyntheticMonitor ||
      monitorType === MonitorType.CustomJavaScriptCode
    ) {
      return true;
    }

    return false;
  }
}
