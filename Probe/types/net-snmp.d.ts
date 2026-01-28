declare module "net-snmp" {
  export const Version1: number;
  export const Version2c: number;
  export const Version3: number;

  export enum SecurityLevel {
    noAuthNoPriv = 1,
    authNoPriv = 2,
    authPriv = 3,
  }

  export const AuthProtocols: {
    md5: AuthProtocol;
    sha: AuthProtocol;
    sha256: AuthProtocol;
    sha512: AuthProtocol;
  };

  export const PrivProtocols: {
    des: PrivProtocol;
    aes: PrivProtocol;
    aes256b: PrivProtocol;
  };

  export const ObjectType: {
    Boolean: number;
    Integer: number;
    OctetString: number;
    Null: number;
    OID: number;
    IpAddress: number;
    Counter: number;
    Counter32: number;
    Gauge: number;
    Gauge32: number;
    TimeTicks: number;
    Opaque: number;
    Counter64: number;
    NoSuchObject: number;
    NoSuchInstance: number;
    EndOfMibView: number;
  };

  export type AuthProtocol = number;
  export type PrivProtocol = number;

  export interface SessionOptions {
    port?: number;
    timeout?: number;
    retries?: number;
    version?: number;
  }

  export interface UserOptions {
    name: string;
    level: SecurityLevel;
    authProtocol?: AuthProtocol;
    authKey?: string;
    privProtocol?: PrivProtocol;
    privKey?: string;
  }

  export interface Varbind {
    oid: string;
    type: number;
    value: unknown;
  }

  export interface Session {
    get(
      oids: string[],
      callback: (error: Error | null, varbinds: Varbind[]) => void,
    ): void;
    close(): void;
  }

  export function createSession(
    target: string,
    community: string,
    options?: SessionOptions,
  ): Session;

  export function createV3Session(
    target: string,
    user: UserOptions,
    options?: SessionOptions,
  ): Session;

  export function isVarbindError(varbind: Varbind): boolean;
}
