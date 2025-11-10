import { ExpressRequest } from "./Express";

export default class RequestMetadata {
  public static getClientIp(req: ExpressRequest): string | undefined {
    const forwardedFor: string | undefined =
      (req.headers["x-forwarded-for"] as string | undefined) || undefined;
    const realIp: string | undefined =
      (req.headers["x-real-ip"] as string | undefined) || undefined;
    const socketAddress: string | undefined = req.socket?.remoteAddress || undefined;
    const reqIp: string | undefined = req.ip;
    const reqIpsFirst: string | undefined = Array.isArray(req.ips)
      ? req.ips[0]
      : undefined;

    const candidate: Array<string | undefined> = [
      forwardedFor,
      realIp,
      socketAddress,
      reqIp,
      reqIpsFirst,
    ];

    for (const value of candidate) {
      if (value && value.trim()) {
        return value.split(",")[0]?.trim();
      }
    }

    return undefined;
  }

  public static getUserAgent(req: ExpressRequest): string | undefined {
    const userAgent: string | undefined = req.headers["user-agent"] as string | undefined;
    return userAgent?.trim() || undefined;
  }

  public static getDevice(req: ExpressRequest): string | undefined {
    const deviceHeader: string | undefined =
      (req.headers["x-device"] as string | undefined) || undefined;

    if (deviceHeader && deviceHeader.trim()) {
      return deviceHeader.trim();
    }

    const userAgent: string | undefined = this.getUserAgent(req);

    if (userAgent) {
      return userAgent;
    }

    return undefined;
  }
}
