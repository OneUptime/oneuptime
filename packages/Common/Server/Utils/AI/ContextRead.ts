import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";

/*
 * WHAT AN AI DRAFT READS FOR A PERSON IS WHAT THEY MAY READ.
 *
 * An AI note or postmortem a person asks for is written from a record's
 * notes (IncidentAIContextBuilder and its siblings). Those are read with
 * that person's props: the permission layer keeps to what they may read -
 * labels, owners, a private record's audience - and refuses the read
 * outright when they may not read the table at all (a role that may post
 * public notes but not read internal ones, a team's block on reading
 * them), which reads here as nothing. So a draft never summarises what its
 * reader could not have opened themselves. Without a reader - OneUptime's
 * own drafts, investigations and runbook steps - the read is OneUptime's,
 * of everything, as it always was.
 */
export interface ContextRows<T> {
  // False when the reader may not read the table at all.
  isPermitted: boolean;
  rows: Array<T>;
}

export async function readContextRows<T>(data: {
  // The person the draft is for; none for OneUptime's own.
  readerProps?: DatabaseCommonInteractionProps | undefined;
  read: (props: DatabaseCommonInteractionProps) => Promise<Array<T>>;
}): Promise<ContextRows<T>> {
  if (!data.readerProps) {
    return { isPermitted: true, rows: await data.read({ isRoot: true }) };
  }

  try {
    return { isPermitted: true, rows: await data.read(data.readerProps) };
  } catch (error) {
    if (error instanceof NotAuthorizedException) {
      return { isPermitted: false, rows: [] };
    }

    throw error;
  }
}
