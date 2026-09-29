// Mock for isolated-vm native module (not loadable in Jest)
export class Isolate {
  public isDisposed: boolean = false;
  public async createContext(): Promise<Context> {
    return new Context();
  }
  public dispose(): void {
    this.isDisposed = true;
  }
}

export class Context {
  public global: Reference = new Reference();
  public async eval(_code: string, _options?: unknown): Promise<unknown> {
    return undefined;
  }
}

export class Reference {
  public async set(_key: string, _value: unknown): Promise<void> {
    return;
  }
  public derefInto(): unknown {
    return {};
  }
  public applySync(_receiver: unknown, _args: unknown[]): unknown {
    return undefined;
  }
  public applySyncPromise(
    _receiver: unknown,
    _args: unknown[],
  ): Promise<unknown> {
    return Promise.resolve(undefined);
  }
}

export class Callback {
  public constructor(_fn: (...args: unknown[]) => void) {}
}

export class ExternalCopy {
  public constructor(_value: unknown) {}
  public copyInto(): unknown {
    return {};
  }
}

export default {
  Isolate,
  Context,
  Reference,
  Callback,
  ExternalCopy,
};
