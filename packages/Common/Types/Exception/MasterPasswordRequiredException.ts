import NotAuthenticatedException from "./NotAuthenticatedException";

export default class MasterPasswordRequiredException extends NotAuthenticatedException {
  public constructor(message: string) {
    super(message);
  }
}
