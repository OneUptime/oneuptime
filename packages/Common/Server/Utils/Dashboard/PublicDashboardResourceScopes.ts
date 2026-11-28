import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import {
  DashboardResourceScope,
  getDashboardResourceScopeAttributes,
  isDashboardResourceScope,
} from "../../../Types/Dashboard/DashboardResourceScope";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import BadDataException from "../../../Types/Exception/BadDataException";
import { ObjectType } from "../../../Types/JSON";

/*
 * A PUBLIC DASHBOARD READS ONLY THE KIND OF RESOURCE ITS VARIABLES PICK AMONG
 * (issue #11258).
 *
 * A signed-in board keeps each widget to the kind of resource a variable
 * picks among (DashboardResourceScope, applied by
 * DashboardVariableInterpolation). A public board's routes take no filter
 * from a request on trust: they rebuild each read from what the stored board
 * draws. This is the kind's part of that, read from the stored variables,
 * never from the request:
 *
 *   - a metric query carries the kind's filters whether the request sent
 *     them or not, and a filter on a key only the kind names is taken only
 *     as the kind writes it ("is empty", "is not empty") - so such a key is
 *     never a way to search values the board does not show;
 *   - a variable's picker lists the kind's values only.
 *
 * Public log streams read the stored variables' kinds through
 * PublicDashboardResourceListPolicy.resolveDashboardVariableSelections.
 */

export const PUBLIC_DASHBOARD_FOREIGN_ATTRIBUTE_MESSAGE: string =
  "This attribute is not part of this dashboard.";

export const PUBLIC_DASHBOARD_FOREIGN_RESOURCE_SCOPE_MESSAGE: string =
  "This kind of resource is not part of this dashboard.";

type ScopeOperatorType = ObjectType.IsNull | ObjectType.NotNull;

// The scope a drawn Telemetry Attribute variable declares, if it is one.
function getVariableScope(
  variable: DashboardVariable,
): DashboardResourceScope | undefined {
  if (
    !variable ||
    variable.type !== DashboardVariableType.TelemetryAttribute ||
    !isDashboardResourceScope(variable.resourceScope)
  ) {
    return undefined;
  }

  return variable.resourceScope;
}

function getOperatorType(value: unknown): ScopeOperatorType | null {
  if (value instanceof IsNull) {
    return ObjectType.IsNull;
  }

  if (value instanceof NotNull) {
    return ObjectType.NotNull;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const type: unknown = (value as Record<string, unknown>)["_type"];

    if (type === ObjectType.IsNull || type === ObjectType.NotNull) {
      return type;
    }
  }

  return null;
}

function toOperator(type: ScopeOperatorType): IsNull | NotNull {
  return type === ObjectType.IsNull ? new IsNull() : new NotNull();
}

export default class PublicDashboardResourceScopes {
  /*
   * Each key the stored variables' kinds filter, with the operators they
   * put on it, in the order the variables are drawn - the order a
   * signed-in board applies them in, where the first to name a key keeps
   * it.
   */
  public static getDeclaredScopeAttributes(
    variables: Array<DashboardVariable> | undefined,
  ): Map<string, Array<ScopeOperatorType>> {
    const declared: Map<string, Array<ScopeOperatorType>> = new Map<
      string,
      Array<ScopeOperatorType>
    >();

    for (const variable of variables || []) {
      const scope: DashboardResourceScope | undefined =
        getVariableScope(variable);

      if (!scope) {
        continue;
      }

      const attributes: Record<string, unknown> =
        getDashboardResourceScopeAttributes(scope);

      for (const key of Object.keys(attributes)) {
        const type: ScopeOperatorType | null = getOperatorType(attributes[key]);

        if (!type) {
          continue;
        }

        const types: Array<ScopeOperatorType> = declared.get(key) || [];

        if (!types.includes(type)) {
          types.push(type);
        }

        declared.set(key, types);
      }
    }

    return declared;
  }

  /*
   * A public metric query's attribute filter, as the board's widgets send
   * it: every key one of them filters, or a variable picks on, as the
   * request sent it; a key only a variable's kind names, only as the kind
   * writes it; and each of the kind's filters the request left out, added -
   * so a request can neither drop the kind nor search a value through it.
   * Any other key is refused.
   */
  public static getMetricQueryAttributes(data: {
    requestedAttributes: Record<string, unknown>;
    allowedFilterAttributeKeys: Set<string>;
    variables: Array<DashboardVariable> | undefined;
  }): Record<string, unknown> {
    const declared: Map<
      string,
      Array<ScopeOperatorType>
    > = PublicDashboardResourceScopes.getDeclaredScopeAttributes(
      data.variables,
    );
    const attributes: Record<string, unknown> = {};

    for (const key of Object.keys(data.requestedAttributes)) {
      const value: unknown = data.requestedAttributes[key];

      if (data.allowedFilterAttributeKeys.has(key)) {
        attributes[key] = value;
        continue;
      }

      const declaredTypes: Array<ScopeOperatorType> | undefined =
        declared.get(key);
      const requestedType: ScopeOperatorType | null = getOperatorType(value);

      if (
        !declaredTypes ||
        !requestedType ||
        !declaredTypes.includes(requestedType)
      ) {
        throw new BadDataException(PUBLIC_DASHBOARD_FOREIGN_ATTRIBUTE_MESSAGE);
      }

      attributes[key] = toOperator(requestedType);
    }

    for (const [key, types] of declared) {
      if (
        Object.prototype.hasOwnProperty.call(attributes, key) ||
        types.length === 0
      ) {
        continue;
      }

      attributes[key] = toOperator(types[0]!);
    }

    return attributes;
  }

  /*
   * The kind a public picker lists the values of: the one every stored
   * variable on the key picks among, whatever the request says; where they
   * differ, the one the request names, which must be one of theirs; none
   * when the request names none and one of them picks among no kind.
   */
  public static getAttributeValueScope(data: {
    variables: Array<DashboardVariable> | undefined;
    attributeKey: string;
    requestedScope: unknown;
  }): DashboardResourceScope | undefined {
    const onKey: Array<DashboardVariable> = (data.variables || []).filter(
      (variable: DashboardVariable): boolean => {
        return (
          Boolean(variable) &&
          variable.type === DashboardVariableType.TelemetryAttribute &&
          typeof variable.attributeKey === "string" &&
          variable.attributeKey.trim() === data.attributeKey
        );
      },
    );

    const scopes: Array<DashboardResourceScope | undefined> = onKey.map(
      (variable: DashboardVariable): DashboardResourceScope | undefined => {
        return getVariableScope(variable);
      },
    );

    const requested: unknown = data.requestedScope;
    const hasRequest: boolean = requested !== undefined && requested !== null;

    if (hasRequest && !isDashboardResourceScope(requested)) {
      throw new BadDataException(
        PUBLIC_DASHBOARD_FOREIGN_RESOURCE_SCOPE_MESSAGE,
      );
    }

    const distinct: Set<DashboardResourceScope | undefined> = new Set<
      DashboardResourceScope | undefined
    >(scopes);

    // No variable on the key (the route refuses such a key first): no kind.
    if (distinct.size === 0) {
      if (hasRequest) {
        throw new BadDataException(
          PUBLIC_DASHBOARD_FOREIGN_RESOURCE_SCOPE_MESSAGE,
        );
      }

      return undefined;
    }

    if (distinct.size === 1) {
      const only: DashboardResourceScope | undefined = scopes[0];

      if (hasRequest && requested !== only) {
        throw new BadDataException(
          PUBLIC_DASHBOARD_FOREIGN_RESOURCE_SCOPE_MESSAGE,
        );
      }

      return only;
    }

    if (!hasRequest) {
      if (distinct.has(undefined)) {
        return undefined;
      }

      // Every variable on the key picks among a kind; none was named.
      throw new BadDataException(
        PUBLIC_DASHBOARD_FOREIGN_RESOURCE_SCOPE_MESSAGE,
      );
    }

    if (!distinct.has(requested as DashboardResourceScope)) {
      throw new BadDataException(
        PUBLIC_DASHBOARD_FOREIGN_RESOURCE_SCOPE_MESSAGE,
      );
    }

    return requested as DashboardResourceScope;
  }
}
