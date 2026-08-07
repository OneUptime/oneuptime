/*
 * Mock for the whois-json ESM module (not parseable by Jest). Wired in by
 * moduleNameMapper in Probe/jest.config.json, so `jest.mock("whois-json")`
 * is never involved and tests drive it through the helpers below.
 */

export type WhoisMockOptions = Record<string, unknown> | undefined;

export type WhoisMockImplementation = (
  domain: string,
  options?: WhoisMockOptions,
) => Promise<unknown>;

export interface WhoisMockCall {
  domain: string;
  options?: WhoisMockOptions;
}

const defaultImplementation: WhoisMockImplementation =
  async (): Promise<unknown> => {
    return {};
  };

let implementation: WhoisMockImplementation = defaultImplementation;

const calls: Array<WhoisMockCall> = [];

const whoisJson: WhoisMockImplementation = async (
  domain: string,
  options?: WhoisMockOptions,
): Promise<unknown> => {
  calls.push({ domain, options });

  return await implementation(domain, options);
};

export function __setWhoisImplementation(impl: WhoisMockImplementation): void {
  implementation = impl;
}

export function __setWhoisResponse(response: unknown): void {
  implementation = async (): Promise<unknown> => {
    return response;
  };
}

export function __setWhoisError(error: Error): void {
  implementation = async (): Promise<unknown> => {
    throw error;
  };
}

export function __getWhoisCalls(): Array<WhoisMockCall> {
  return calls;
}

export function __resetWhoisMock(): void {
  implementation = defaultImplementation;
  calls.length = 0;
}

export default whoisJson;
