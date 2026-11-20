import ReadAudiencePermission from "../../../Types/Database/Permissions/ReadAudiencePermission";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ReadAudience from "../../../../Types/BaseDatabase/ReadAudience";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";

/*
 * WHOSE READS ONEUPTIME AI'S MEMORY MAKES (#7672).
 *
 * What OneUptime AI remembers (AIMemory) and has learned about a service
 * (ServiceKnowledge) is read for one of two readers:
 *
 *   - an investigation's: everyone who may see its incident or alert reads
 *     its report, so it reads what every one of them may read
 *     (ReadAudience, #9576) - never a private record, nor one an owner or a
 *     label sets apart from one of them;
 *   - a person's, on a service's page: what that person may read, with
 *     their own permissions - an incident, an alert, a fix or an analysis
 *     they may not read is never named or counted on the page.
 *
 * Every read of the memory is made with the reader's props (propsOf), so
 * the permission layer narrows it either way. A person's role may not read
 * one kind at all (alerts, OneUptime AI's runs, its fixes): that read is a
 * read of nothing (orNothing), and the rest of what they may read is still
 * shown.
 */
export type MemoryReader =
  | {
      // Everyone who may see the subject of a run of OneUptime AI's.
      readAudience: ReadAudience;
      props?: undefined;
    }
  | {
      // A person's own, as a request of theirs carries them.
      props: DatabaseCommonInteractionProps;
      readAudience?: undefined;
    };

export default class MemoryReads {
  // The props every read for the reader is made with.
  public static propsOf(reader: MemoryReader): DatabaseCommonInteractionProps {
    if (reader.readAudience) {
      return ReadAudiencePermission.getReadProps(reader.readAudience);
    }

    return reader.props!;
  }

  // The reader as a request's own: just the reader, nothing else of `data`.
  public static readerOf(data: MemoryReader): MemoryReader {
    return data.readAudience
      ? { readAudience: data.readAudience }
      : { props: data.props! };
  }

  /*
   * A read the reader may not make - a role that may not read the kind, or
   * a plan that does not include it - is a read of nothing. Anything else
   * that goes wrong is thrown, for the caller to handle as it does.
   */
  public static async orNothing<T>(
    read: () => Promise<Array<T>>,
  ): Promise<Array<T>> {
    try {
      return await read();
    } catch (error) {
      if (
        error instanceof NotAuthorizedException ||
        error instanceof PaymentRequiredException
      ) {
        return [];
      }

      throw error;
    }
  }
}
