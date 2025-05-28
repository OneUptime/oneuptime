import dns from "dns";

export default class DNSUtil {
  public static getCnameRecord(data: { domain: string }): Promise<string> {
    return new Promise((resolve: (value: string) => void, reject: (error: Error) => void) => {
      dns.resolveCname(
        data.domain,
        (err: Error | null, addresses: string[]) => {
          if (err) {
            reject(err);
          } else if (addresses.length > 0) {
            resolve(addresses[0]!);
          } else {
            reject(
              new Error("No CNAME record found for domain: " + data.domain),
            );
          }
        },
      );
    });
  }
}
