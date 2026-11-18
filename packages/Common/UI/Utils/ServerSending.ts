import { APP_API_URL } from "../Config";
import API from "./API/API";
import GlobalConfigUtil, { GlobalConfigVars } from "./GlobalConfig";
import ProjectUtil from "./Project";
import UserUtil from "./User";
import ProjectCanSend, {
  PROJECT_CAN_SEND_API_PATH,
  ProjectCanSendAnswer,
} from "../../Types/ServerSending/ProjectCanSend";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../Types/API/HTTPMethod";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import ServerSendingStatusUtil, {
  ServerSendingStatusAnswer,
} from "../../Types/ServerSending/ServerSendingStatus";
import { useEffect, useState } from "react";

/*
 * WHETHER THIS SERVER CAN SEND, AS A PAGE READS IT.
 *
 *   - useServerCanSendEmail: anybody's page - the sign-in pages, the invite
 *     dialogs, Home, Create Monitor - from GET /global-config/vars'
 *     canSendEmail, read once per page load (GlobalConfigUtil). False only
 *     while the server is known not to be able to send email; null while the
 *     answer is on its way. A read that fails answers true: the page then
 *     says what it always said, and the server still refuses what it must.
 *   - ServerSendingStatusLoader / useServerSendingStatus: a master admin's
 *     page, from GET /global-config/sending-status - every channel, since
 *     when it fails and why, and whether the global probes report. One
 *     request per page load serves every component that draws it; one that
 *     fails draws nothing, and is asked again by the next one that mounts.
 *
 * Both are kept until something changes what the server can send: a save
 * of its settings, or a test send. That clears them
 * (ServerSendingStatusLoader.clear), and every component still drawing the
 * sending status reads it again at once (#7459). The banner at the top of
 * the Admin Dashboard is mounted once for the whole visit, so it read the
 * answer once: email saved and a test email delivered, it still said
 * "Email is not set up" until a reload.
 */

export const useServerCanSendEmail: () => boolean | null = ():
  | boolean
  | null => {
  const [canSendEmail, setCanSendEmail] = useState<boolean | null>(null);

  useEffect(() => {
    let isMounted: boolean = true;

    GlobalConfigUtil.fetchVars()
      .then((vars: GlobalConfigVars): void => {
        if (isMounted) {
          setCanSendEmail(vars.canSendEmail !== false);
        }
      })
      .catch((): void => {
        if (isMounted) {
          setCanSendEmail(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return canSendEmail;
};

// Told when the kept answer is forgotten, so whoever draws it reads it again.
export type ServerSendingStatusClearedListener = () => void;

export default class ServerSendingStatusLoader {
  private static pending: Promise<ServerSendingStatusAnswer | null> | null =
    null;

  private static listeners: Set<ServerSendingStatusClearedListener> =
    new Set<ServerSendingStatusClearedListener>();

  // Whether this reader may be told: a master admin, the only one who can fix it.
  public static isShownToReader(): boolean {
    return Boolean(UserUtil.isMasterAdmin());
  }

  public static load(): Promise<ServerSendingStatusAnswer | null> {
    if (!this.isShownToReader()) {
      return Promise.resolve(null);
    }

    if (!this.pending) {
      const pending: Promise<ServerSendingStatusAnswer | null> = this.fetch();
      this.pending = pending;

      pending
        .then((answer: ServerSendingStatusAnswer | null): void => {
          // Ask again next time rather than keep a failure for the page's life.
          if (!answer && this.pending === pending) {
            this.pending = null;
          }
        })
        .catch((): void => {
          if (this.pending === pending) {
            this.pending = null;
          }
        });
    }

    return this.pending;
  }

  /*
   * Forgets what this page has read of whether the server can send - the
   * sending status, and GET /global-config/vars' canSendEmail - so the next
   * load asks again, and tells every component drawing the sending status
   * to read it again now. Called once the server's settings are saved or a
   * test is sent: what it can send may have changed with them.
   */
  public static clear(): void {
    this.pending = null;
    GlobalConfigUtil.clearCache();
    ProjectCanSendLoader.clear();

    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch {
        // One reader that fails costs the others nothing.
      }
    }
  }

  // Calls the listener on every clear() until the returned function is called.
  public static onCleared(
    listener: ServerSendingStatusClearedListener,
  ): () => void {
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }

  private static async fetch(): Promise<ServerSendingStatusAnswer | null> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.fetch<JSONObject>({
          method: HTTPMethod.GET,
          url: URL.fromURL(APP_API_URL).addRoute(
            new Route("/global-config/sending-status"),
          ),
        });

      if (!response.isSuccess()) {
        return null;
      }

      return ServerSendingStatusUtil.parseAnswer(response.data);
    } catch {
      // Nothing to say: the banner only ever helps.
      return null;
    }
  }
}

/*
 * WHETHER A PAGE CAN REACH THIS PROJECT'S PEOPLE (#7151, #6880): GET
 * /project-can-send, which any member of the project reads - three
 * yes-or-noes, never why (Types/ServerSending/ProjectCanSend). One request
 * per project for the page's life, shared by every component that asks;
 * one that fails is asked again by the next.
 */
export class ProjectCanSendLoader {
  private static pending: Map<string, Promise<ProjectCanSendAnswer | null>> =
    new Map<string, Promise<ProjectCanSendAnswer | null>>();

  public static load(projectId: string): Promise<ProjectCanSendAnswer | null> {
    const kept: Promise<ProjectCanSendAnswer | null> | undefined =
      this.pending.get(projectId);

    if (kept) {
      return kept;
    }

    const pending: Promise<ProjectCanSendAnswer | null> = this.fetch(projectId);

    this.pending.set(projectId, pending);

    pending
      .then((answer: ProjectCanSendAnswer | null): void => {
        // Ask again next time rather than keep a failure for the page's life.
        if (!answer && this.pending.get(projectId) === pending) {
          this.pending.delete(projectId);
        }
      })
      .catch((): void => {
        this.pending.delete(projectId);
      });

    return pending;
  }

  public static clear(): void {
    this.pending.clear();
  }

  private static async fetch(
    projectId: string,
  ): Promise<ProjectCanSendAnswer | null> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.fetch<JSONObject>({
          method: HTTPMethod.GET,
          url: URL.fromURL(APP_API_URL).addRoute(
            new Route(PROJECT_CAN_SEND_API_PATH),
          ),
          headers: { tenantid: projectId },
        });

      if (!response.isSuccess()) {
        return null;
      }

      return ProjectCanSend.parse(response.data);
    } catch {
      // Not known: every page says what it always said, and the server decides.
      return null;
    }
  }
}

/*
 * Whether a page can reach the current project's people by email, SMS and
 * call; null while that is not known - the answer is on its way, there is
 * no project, or it could not be read. A page says a channel cannot reach
 * anyone only once it knows: `answer?.sms === false`.
 */
export const useProjectCanSend: () => ProjectCanSendAnswer | null =
  (): ProjectCanSendAnswer | null => {
    const projectId: string =
      ProjectUtil.getCurrentProjectId()?.toString() || "";
    const [answer, setAnswer] = useState<ProjectCanSendAnswer | null>(null);

    useEffect(() => {
      let isCurrent: boolean = true;

      setAnswer(null);

      if (!projectId) {
        return () => {
          isCurrent = false;
        };
      }

      ProjectCanSendLoader.load(projectId)
        .then((loaded: ProjectCanSendAnswer | null): void => {
          if (isCurrent) {
            setAnswer(loaded);
          }
        })
        .catch((): void => {
          // load() never rejects; nothing to say if it did.
        });

      return () => {
        isCurrent = false;
      };
    }, [projectId]);

    return answer;
  };

/*
 * The sending status, once loaded; null before, for anyone else, or on a
 * failure. Read again each time the kept answer is cleared, keeping what it
 * shows until the new answer comes: only the latest read is drawn, so an
 * answer that was on its way when the settings changed never replaces the
 * one read after.
 */
export const useServerSendingStatus: () => ServerSendingStatusAnswer | null =
  (): ServerSendingStatusAnswer | null => {
    const [answer, setAnswer] = useState<ServerSendingStatusAnswer | null>(
      null,
    );

    useEffect(() => {
      let isCurrent: boolean = true;
      let latestRead: number = 0;

      const read: () => void = (): void => {
        const thisRead: number = ++latestRead;

        ServerSendingStatusLoader.load()
          .then((loaded: ServerSendingStatusAnswer | null): void => {
            if (isCurrent && thisRead === latestRead) {
              setAnswer(loaded);
            }
          })
          .catch((): void => {
            // load() never rejects; nothing to draw if it did.
          });
      };

      const stopListening: () => void =
        ServerSendingStatusLoader.onCleared(read);

      read();

      return () => {
        isCurrent = false;
        stopListening();
      };
    }, []);

    return answer;
  };
