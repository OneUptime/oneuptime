import net from "net";

/*
 * A SERVICE'S CLUSTER IP, AS KUBE-PROXY BALANCES IT (issue #11121).
 *
 * kube-proxy (iptables or IPVS) sends each new TCP connection to a Service
 * to one of its ready endpoints, picked at random, and every packet of that
 * connection to the same endpoint for as long as it lives: it balances
 * connections, not requests. A request sent on a kept-alive connection
 * goes wherever the connection went when it was opened. This does the same
 * in the benchmark: a TCP listener that sends each connection it accepts to
 * one of its endpoints, picked at random, and pipes the bytes both ways.
 * Endpoints are added while it runs, as pods KEDA adds become Ready; the
 * connections open already stay where they are.
 *
 * It counts the connections it sent to each endpoint, so a run can tell how
 * the traffic was spread.
 */

export interface BalancedEndpoint {
  // Which App replica it is, as the harness numbers them.
  replica: number;
  port: number;
}

export default class ConnectionBalancer {
  private endpoints: Array<BalancedEndpoint> = [];
  private server: net.Server | null = null;
  private sockets: Set<net.Socket> = new Set<net.Socket>();
  // Connections sent to each replica since the start.
  public readonly connectionsSent: Map<number, number> = new Map<
    number,
    number
  >();
  public port: number = 0;

  public constructor(private readonly random: () => number) {}

  // A pod that became Ready: new connections may go to it from now on.
  public addEndpoint(endpoint: BalancedEndpoint): void {
    this.endpoints.push(endpoint);
    this.connectionsSent.set(
      endpoint.replica,
      this.connectionsSent.get(endpoint.replica) || 0,
    );
  }

  public endpointCount(): number {
    return this.endpoints.length;
  }

  // Listens on `port` (0: any free port) of 127.0.0.1; answers the port.
  public start(port: number = 0): Promise<number> {
    this.server = net.createServer((client: net.Socket): void => {
      this.forward(client);
    });

    return new Promise<number>(
      (resolve: (port: number) => void, reject: (error: Error) => void) => {
        this.server!.once("error", reject);
        this.server!.listen(port, "127.0.0.1", (): void => {
          this.port = (this.server!.address() as net.AddressInfo).port;
          resolve(this.port);
        });
      },
    );
  }

  private forward(client: net.Socket): void {
    if (this.endpoints.length === 0) {
      client.destroy();
      return;
    }

    const endpoint: BalancedEndpoint =
      this.endpoints[
        Math.min(
          this.endpoints.length - 1,
          Math.floor(this.random() * this.endpoints.length),
        )
      ]!;

    this.connectionsSent.set(
      endpoint.replica,
      (this.connectionsSent.get(endpoint.replica) || 0) + 1,
    );

    const upstream: net.Socket = net.connect(endpoint.port, "127.0.0.1");

    client.setNoDelay(true);
    upstream.setNoDelay(true);
    this.sockets.add(client);
    this.sockets.add(upstream);

    // One side closing or failing ends the other, as a TCP proxy does.
    const end: (socket: net.Socket) => () => void = (
      socket: net.Socket,
    ): (() => void) => {
      return (): void => {
        this.sockets.delete(socket);
        client.destroy();
        upstream.destroy();
      };
    };

    client.on("error", end(client));
    upstream.on("error", end(upstream));
    client.on("close", end(client));
    upstream.on("close", end(upstream));

    client.pipe(upstream);
    upstream.pipe(client);
  }

  public stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }

    this.sockets.clear();

    return new Promise<void>((resolve: () => void): void => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((): void => {
        resolve();
      });
    });
  }
}
