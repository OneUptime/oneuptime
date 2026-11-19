import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";

/*
 * Whether a read was refused for who is asking (a role, a plan), not failed.
 *
 * A module of its own, which reads no record: a security case's context
 * asks it too (SecurityCaseContextScope), and the services the connections
 * read reach that context at load - a case's evidence reads whether a kept
 * event is readable (SecurityCaseMatches). Asked of the connections, it
 * loaded them part way through those services (ConnectionsLoadOrder).
 */
export function isRefusedRead(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException
  );
}
