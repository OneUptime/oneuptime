import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/GlobalConfig";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import ObjectID from "../../Types/ObjectID";
import { OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  /*
   * Caches the instance-wide "Require SSO for Login" flag. This is read on the
   * authenticated request path (per project), so it must not hit Postgres every
   * time. Refreshed at most once per 60s and invalidated on update below.
   */
  private requireSsoForLoginCache: InMemoryTTLCache<boolean> =
    new InMemoryTTLCache(10_000);

  public constructor() {
    super(Model);
  }

  /*
   * Instance-wide: must every user sign in with SSO to access projects?
   * (Master admins are exempted by the enforcement layer, not here.)
   */
  @CaptureSpan()
  public async getRequireSsoForLogin(): Promise<boolean> {
    const key: string = "global";
    const cached: boolean | undefined = this.requireSsoForLoginCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const config: Model | null = await this.findOneBy({
      query: {},
      select: { requireSsoForLogin: true },
      props: { isRoot: true },
    });

    const value: boolean = Boolean(config?.requireSsoForLogin);
    this.requireSsoForLoginCache.set(key, value, 60_000);
    return value;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (
      (onUpdate.updateBy.data as { requireSsoForLogin?: unknown })
        .requireSsoForLogin !== undefined
    ) {
      this.requireSsoForLoginCache.clear();
    }

    return onUpdate;
  }
}

export default new Service();
