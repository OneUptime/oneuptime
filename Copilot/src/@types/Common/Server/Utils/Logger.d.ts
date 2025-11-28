declare module "Common/Server/Utils/Logger" {
  interface Logger {
    info(message: unknown): void;
    error(message: unknown): void;
    warn(message: unknown): void;
    debug(message: unknown): void;
    trace(message: unknown): void;
  }

  const logger: Logger;
  export default logger;
}
