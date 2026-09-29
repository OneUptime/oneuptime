/*
 * The origin of the sandbox's internal controller document.
 *
 * `.invalid` is reserved by RFC 2606 so that it can never resolve, which is
 * exactly what is wanted here: the origin is unspoofable, it is distinct from
 * anything the tenant's script can reach, and nothing ever leaves the process
 * for it -- WorkerController fulfils the navigation from memory with
 * page.route.
 *
 * It lives in its own module rather than beside the controller because the
 * supervisor process needs the host name (to keep it out of every proxy) and
 * must not pay for Playwright's client library to learn it. Nothing may be
 * imported here.
 */
export const SYNTHETIC_RUNTIME_CONTROLLER_HOST: string =
  "synthetic-runtime.oneuptime.invalid";

export const SYNTHETIC_RUNTIME_CONTROLLER_ORIGIN: string = `https://${SYNTHETIC_RUNTIME_CONTROLLER_HOST}`;
