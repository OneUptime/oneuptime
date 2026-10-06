import ModelPermission from "../../Types/AnalyticsDatabase/ModelPermission";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../Models/AnalyticsModels/Log";
import Metric from "../../../Models/AnalyticsModels/Metric";
import Profile from "../../../Models/AnalyticsModels/Profile";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import Span from "../../../Models/AnalyticsModels/Span";
import BadDataException from "../../../Types/Exception/BadDataException";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "./TelemetryReadScope";
import CaptureSpan from "./CaptureSpan";

/*
 * THE ONE WAY A TELEMETRY READ OUTSIDE THE MODEL READ PATH LEARNS WHAT THE
 * CALLER MAY READ.
 *
 * The /telemetry/* routes, the attribute pickers and the AI tools build
 * their own ClickHouse SQL (histograms, facets, analytics, exports, profile
 * flame graphs, session replays ...), so nothing downstream narrows it to
 * the caller. Each of them asks here, with the analytics model whose rows
 * it reads, and applies the answer:
 *
 *   - getServiceFilter: the serviceIds / excludedServiceIds to hand an
 *     aggregation request, given the services the caller asked for;
 *   - getScope: the scope itself, for a read that checks one resource (a
 *     log's surrounding lines, a stack trace's source maps, one profile)
 *     or filters rows of its own (the facet sidebars' resource lists);
 *   - getScopeForPermissions: the same for a route that accepts a list of
 *     permissions of its own (session replays).
 *
 * The scope comes from the analytics permission layer
 * (ModelPermission.getReadScope), the same one the model reads apply, so a
 * route can never let a caller read more than the CRUD API for the same
 * rows would. Tests/Server/API/TelemetryRoutesReadScope.test.ts keeps every
 * /telemetry/* route asking, and Tests/Server/Utils/AI/
 * ToolboxTelemetryReadScope.test.ts every AI tool.
 */
export default class TelemetryReadAccess {
  /*
   * The analytics model whose rows a telemetry signal's attribute keys and
   * values come from, for the scope an attribute picker applies.
   */
  public static getModelForTelemetryType(telemetryType: TelemetryType): {
    new (): AnalyticsBaseModel;
  } {
    switch (telemetryType) {
      case TelemetryType.Metric:
        return Metric;
      case TelemetryType.Log:
        return Log;
      case TelemetryType.Trace:
        return Span;
      case TelemetryType.Exception:
        return ExceptionInstance;
      case TelemetryType.SecurityEvent:
        return SecurityEvent;
      case TelemetryType.Profile:
        return Profile;
      default:
        throw new BadDataException(`Unknown telemetry type: ${telemetryType}`);
    }
  }

  // Whose telemetry of this model the caller may read.
  @CaptureSpan()
  public static async getScope(
    modelType: { new (): AnalyticsBaseModel },
    props: DatabaseCommonInteractionProps,
  ): Promise<TelemetryReadScope> {
    return await ModelPermission.getReadScope(
      modelType,
      props,
      DatabaseRequestType.Read,
    );
  }

  /*
   * The same for a list of permissions a route accepts on its own (session
   * replay's list, payload and identity grants). `wildcard` is the
   * *AllOperationalResources permission the route also accepts, if any, and
   * `resourceTypes` the telemetry-owning resource types the rows belong to
   * (OwnerTableRegistry keys; absent: every type).
   */
  @CaptureSpan()
  public static async getScopeForPermissions(data: {
    props: DatabaseCommonInteractionProps;
    permissions: ReadonlyArray<Permission>;
    wildcard?: Permission | null | undefined;
    includeProjectScope?: boolean | undefined;
    resourceTypes?: ReadonlyArray<string> | undefined;
    recordName: string;
  }): Promise<TelemetryReadScope> {
    return await ModelPermission.getReadScopeForPermissions({
      props: data.props,
      permissions: data.permissions,
      wildcard: data.wildcard,
      includeProjectScope: data.includeProjectScope,
      resourceTypes: data.resourceTypes,
      recordName: data.recordName,
      operation: DatabaseRequestType.Read,
    });
  }

  /*
   * The same rule for ONE resource a route reads again and again (a session
   * replay's application, on every page of a playback), decided from the
   * resource's labels and - only when an Owned grant has to be weighed - its
   * owners, rather than by looking up every resource the caller may read.
   * Refuses as getScopeForPermissions does.
   */
  @CaptureSpan()
  public static async isResourceReadableForPermissions(data: {
    props: DatabaseCommonInteractionProps;
    permissions: ReadonlyArray<Permission>;
    wildcard?: Permission | null | undefined;
    resourceTypes?: ReadonlyArray<string> | undefined;
    recordName: string;
    resource: {
      id: string;
      labelIds: ReadonlyArray<string>;
      getOwners: () => Promise<{
        userIds: ReadonlyArray<string>;
        teamIds: ReadonlyArray<string>;
      }>;
    };
  }): Promise<boolean> {
    return await ModelPermission.isResourceReadableForPermissions({
      props: data.props,
      permissions: data.permissions,
      wildcard: data.wildcard,
      resourceTypes: data.resourceTypes,
      recordName: data.recordName,
      operation: DatabaseRequestType.Read,
      resource: data.resource,
    });
  }

  /*
   * Whether the caller reads every resource under a list of permissions (a
   * grant over the whole project, no block with labels), without looking
   * anything up. Refuses as getScopeForPermissions does.
   */
  public static readsEveryResourceForPermissions(data: {
    props: DatabaseCommonInteractionProps;
    permissions: ReadonlyArray<Permission>;
    wildcard?: Permission | null | undefined;
    recordName: string;
  }): boolean {
    return ModelPermission.readsEveryResourceForPermissions({
      props: data.props,
      permissions: data.permissions,
      wildcard: data.wildcard,
      recordName: data.recordName,
      operation: DatabaseRequestType.Read,
    });
  }

  /*
   * The serviceIds and excludedServiceIds an aggregation request of this
   * model takes for the caller, given the services they asked for (none:
   * every service they may read). See TelemetryReadScope.toServiceFilter.
   */
  @CaptureSpan()
  public static async getServiceFilter(data: {
    modelType: { new (): AnalyticsBaseModel };
    props: DatabaseCommonInteractionProps;
    requested?: ReadonlyArray<ObjectID | string> | null | undefined;
  }): Promise<TelemetryServiceFilter> {
    const scope: TelemetryReadScope = await TelemetryReadAccess.getScope(
      data.modelType,
      data.props,
    );

    return TelemetryReadScopeUtil.toServiceFilter(scope, data.requested);
  }
}
