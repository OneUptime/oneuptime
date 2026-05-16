import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/UserWebhook";
import URL from "../../Types/API/URL";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.webhookUrl) {
      throw new BadDataException("Webhook URL is required");
    }

    if (!createBy.data.name) {
      throw new BadDataException("Webhook name is required");
    }

    this.validateWebhookUrl(createBy.data.webhookUrl);

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /* Webhooks skip verification, so default on-call rules are seeded at create time. */
    if (createdItem.projectId && createdItem.userId && createdItem.id) {
      try {
        await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
          {
            projectId: createdItem.projectId,
            userId: createdItem.userId,
            notificationMethod: {
              userWebhookId: createdItem.id,
            },
          },
        );
      } catch (err) {
        logger.error(err);
      }
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToDelete: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: {
        _id: true,
        projectId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const item of itemsToDelete) {
      await UserNotificationRuleService.deleteBy({
        query: {
          userWebhookId: item.id!,
          projectId: item.projectId!,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    }

    return {
      deleteBy,
      carryForward: null,
    };
  }

  private validateWebhookUrl(rawUrl: string): void {
    let parsed: URL;
    try {
      parsed = URL.fromString(rawUrl);
    } catch {
      throw new BadDataException("Webhook URL is not a valid URL");
    }

    const protocolValue: string = parsed.protocol.toString().toLowerCase();
    if (protocolValue !== "http://" && protocolValue !== "https://") {
      throw new BadDataException(
        "Webhook URL must use http or https protocol.",
      );
    }

    const hostname: string = parsed.hostname.hostname.toLowerCase();

    if (!hostname) {
      throw new BadDataException("Webhook URL must include a host.");
    }

    if (isBlockedHostnameLiteral(hostname)) {
      throw new BadDataException(
        "Webhook URL points to a private, loopback, or link-local address and is not allowed.",
      );
    }
  }
}

function isBlockedHostnameLiteral(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  ) {
    return true;
  }

  // IPv4 literal check
  const ipv4Match: RegExpMatchArray | null = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (ipv4Match) {
    const octets: Array<number> = [
      Number(ipv4Match[1]),
      Number(ipv4Match[2]),
      Number(ipv4Match[3]),
      Number(ipv4Match[4]),
    ];

    if (
      octets.some((o: number) => {
        return o < 0 || o > 255;
      })
    ) {
      return true;
    }

    // 0.0.0.0/8
    if (octets[0] === 0) {
      return true;
    }
    // 127.0.0.0/8 loopback
    if (octets[0] === 127) {
      return true;
    }
    // 10.0.0.0/8
    if (octets[0] === 10) {
      return true;
    }
    // 172.16.0.0/12
    if (octets[0] === 172 && (octets[1]! & 0xf0) === 16) {
      return true;
    }
    // 192.168.0.0/16
    if (octets[0] === 192 && octets[1] === 168) {
      return true;
    }
    // 169.254.0.0/16 link-local (incl. cloud metadata)
    if (octets[0] === 169 && octets[1] === 254) {
      return true;
    }
    // 100.64.0.0/10 carrier-grade NAT
    if (octets[0] === 100 && (octets[1]! & 0xc0) === 64) {
      return true;
    }
    return false;
  }

  // IPv6 literal — block loopback, link-local, unique-local
  if (hostname.includes(":")) {
    const stripped: string = hostname.replace(/^\[|\]$/g, "");
    if (stripped === "::1" || stripped === "::") {
      return true;
    }
    if (stripped.startsWith("fe80:") || stripped.startsWith("fe80::")) {
      return true;
    }
    if (IPV6_UNIQUE_LOCAL_REGEX.test(stripped)) {
      return true;
    }
  }

  return false;
}

const IPV6_UNIQUE_LOCAL_REGEX: RegExp = /^f[cd][0-9a-f]{2}:/;

export default new Service();
