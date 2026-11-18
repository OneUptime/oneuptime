import {
  ReadinessSummaryWire,
  UserReadinessWire,
  parseReadinessSummary,
} from "./ReadinessTypes";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * THE SIGNED-IN PERSON'S OWN READINESS, AS LAST READ IN THIS TAB: the
 * server's answer to "can OneUptime reach me in this project"
 * (/on-call-readiness/user/:userId, OnCallReadinessService), kept per
 * project and person.
 *
 * Two places read it: the notification bell, which asks somebody on an
 * on-call policy to finish their setup (#7040), and the setup checklist,
 * which reads it fresh on every load and on Recheck. The checklist hands
 * each fresh answer here, so a person who fixes their setup and rechecks
 * sees the bell's item go at once, rather than at the bell's next read.
 */

export interface MyReadinessReading {
  readiness: UserReadinessWire;
  // When it was read (Date.now()).
  readAt: number;
}

type Listener = () => void;

const readings: Map<string, MyReadinessReading> = new Map();
const listeners: Set<Listener> = new Set();
const inFlight: Map<string, Promise<UserReadinessWire>> = new Map();

const keyOf: (projectId: string, userId: string) => string = (
  projectId: string,
  userId: string,
): string => {
  return `${projectId.toLowerCase()}:${userId.toLowerCase()}`;
};

export default class MyReadiness {
  // Keeps an answer just read, and tells whoever listens.
  public static record(data: {
    projectId: string;
    userId: string;
    readiness: UserReadinessWire;
    readAt?: number | undefined;
  }): void {
    readings.set(keyOf(data.projectId, data.userId), {
      readiness: data.readiness,
      readAt: data.readAt ?? Date.now(),
    });

    for (const listener of Array.from(listeners)) {
      listener();
    }
  }

  public static get(data: {
    projectId: string;
    userId: string;
  }): MyReadinessReading | null {
    return readings.get(keyOf(data.projectId, data.userId)) || null;
  }

  // Called after every answer kept. Returns what stops it.
  public static subscribe(listener: Listener): () => void {
    listeners.add(listener);

    return (): void => {
      listeners.delete(listener);
    };
  }

  /*
   * Reads the person's readiness in the project the request is made in
   * (its tenant header), keeps it, and returns it. Throws what the read
   * did, as API.get answered it. A read already on its way for the same
   * person and project is shared, not asked for again.
   */
  public static load(data: {
    projectId: string;
    userId: string;
  }): Promise<UserReadinessWire> {
    const key: string = keyOf(data.projectId, data.userId);
    const pending: Promise<UserReadinessWire> | undefined = inFlight.get(key);

    if (pending) {
      return pending;
    }

    const read: Promise<UserReadinessWire> = MyReadiness.read(data).finally(
      () => {
        inFlight.delete(key);
      },
    );

    inFlight.set(key, read);

    return read;
  }

  private static async read(data: {
    projectId: string;
    userId: string;
  }): Promise<UserReadinessWire> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          `/on-call-readiness/user/${data.userId}`,
        ),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    const readiness: UserReadinessWire | undefined = parseUserReadiness(
      response.data,
    );

    if (!readiness) {
      throw new Error("Could not read your notification setup.");
    }

    MyReadiness.record({
      projectId: data.projectId,
      userId: data.userId,
      readiness: readiness,
    });

    return readiness;
  }

  // Forgets every answer: a sign-out, and tests.
  public static clear(): void {
    readings.clear();
    inFlight.clear();
  }
}

/*
 * The per-user route answers with a bare UserReadiness rather than a
 * summary, so it is wrapped into the one shape ReadinessTypes knows how to
 * read, as the setup checklist reads it. Undefined for an answer that names
 * nobody.
 */
export const parseUserReadiness: (
  data: JSONObject,
) => UserReadinessWire | undefined = (
  data: JSONObject,
): UserReadinessWire | undefined => {
  const summary: ReadinessSummaryWire = parseReadinessSummary({
    users: [data],
  } as JSONObject);

  const readiness: UserReadinessWire | undefined = summary.users[0];

  return readiness && readiness.userId ? readiness : undefined;
};
