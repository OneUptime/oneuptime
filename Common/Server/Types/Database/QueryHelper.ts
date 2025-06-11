import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Text from "../../../Types/Text";
import Typeof from "../../../Types/Typeof";
import { FindOperator, Raw } from "typeorm";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import CaptureSpan from "../../Utils/Telemetry/CaptureSpan";

export default class QueryHelper {
  @CaptureSpan()
  public static modulo(
    moduloBy: number,
    reminder: number,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    const rid2: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} % :${rid} = :${rid2})`;
      },
      {
        [rid]: moduloBy,
        [rid2]: reminder,
      },
    );
  }

  @CaptureSpan()
  public static findWithSameText(
    text: string | number,
  ): FindWhereProperty<any> {
    let isString: boolean = false;

    if (typeof text === Typeof.String) {
      text = (text as string).toLowerCase().trim();
      isString = true;
    }
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return isString
          ? `(LOWER(${alias}) = :${rid})`
          : `(${alias} = :${rid})`;
      },
      {
        [rid]: `${text}`,
      },
    );
  }

  @CaptureSpan()
  public static isNull(): any {
    return Raw((alias: string) => {
      return `(${alias} IS NULL)`;
    });
  }

  @CaptureSpan()
  public static notNull(): any {
    return Raw((alias: string) => {
      return `(${alias} IS NOT NULL)`;
    });
  }

  @CaptureSpan()
  public static equalToOrNull(
    value: string | ObjectID | Array<string | ObjectID>,
  ): FindWhereProperty<any> {
    const rid: Array<string> = [];
    const valuesObj: Dictionary<string> = {};

    if (Array.isArray(value)) {
      for (const item of value) {
        const temp: string = Text.generateRandomText(10);
        rid.push(temp);
        valuesObj[temp] = item.toString();
      }
    } else {
      const temp: string = Text.generateRandomText(10);
      rid.push(temp);
      valuesObj[temp] = value.toString();
    }

    // construct string

    type ConstructQueryFunction = (alias: string) => string;

    const constructQuery: ConstructQueryFunction = (alias: string): string => {
      let query: string = "(";

      query += rid
        .map((item: string) => {
          return `${alias} = :${item}`;
        })
        .join(" or ");

      query += ` or ${alias} IS NULL)`;

      return query;
    };

    return Raw(
      (alias: string) => {
        return constructQuery(alias);
      },
      {
        ...valuesObj,
      },
    );
  }

  @CaptureSpan()
  public static notEquals(value: string | ObjectID): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} != :${rid})`;
      },
      {
        [rid]: value.toString(),
      },
    );
  }

  @CaptureSpan()
  public static search(name: string): FindWhereProperty<any> {
    name = name.toLowerCase().trim();
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `((CAST(${alias} AS TEXT) ILIKE :${rid}))`;
      },
      {
        [rid]: `%${name}%`,
      },
    );
  }

  @CaptureSpan()
  public static all(values: Array<string | ObjectID>): FindWhereProperty<any> {
    values = values.map((value: string | ObjectID) => {
      return value.toString();
    });
    const rid: string = Text.generateRandomText(10);

    if (!values || values.length === 0) {
      return Raw(() => {
        return `TRUE = FALSE`; // this will always return false
      }, {});
    }

    return Raw(
      (alias: string) => {
        return `(${alias} = ALL(:${rid}))`;
      },
      {
        [rid]: values,
      },
    );
  }

  @CaptureSpan()
  public static any(
    values: Array<string | ObjectID | number>,
  ): FindWhereProperty<any> {
    return this.in(values); // any and in are the same
  }

  private static in(
    values: Array<string | ObjectID | number>,
  ): FindWhereProperty<any> {
    values = values.map((value: string | ObjectID | number) => {
      return value.toString();
    });
    const rid: string = Text.generateRandomText(10);

    if (!values || values.length === 0) {
      return Raw(() => {
        return `TRUE = FALSE`; // this will always return false
      }, {});
    }

    return Raw(
      (alias: string) => {
        return `(${alias} IN (:...${rid}))`;
      },
      {
        [rid]: values,
      },
    );
  }

  @CaptureSpan()
  public static notIn(
    values: Array<string | ObjectID>,
  ): FindWhereProperty<any> {
    values = values.map((value: string | ObjectID) => {
      return value.toString();
    });
    const rid: string = Text.generateRandomText(10);

    if (!values || values.length === 0) {
      return Raw(() => {
        return `TRUE = TRUE`; // this will always return true
      }, {});
    }

    return Raw(
      (alias: string) => {
        return `(${alias} NOT IN (:...${rid}))`;
      },
      {
        [rid]: values,
      },
    );
  }

  @CaptureSpan()
  public static notInOrNull(
    values: Array<string | ObjectID>,
  ): FindWhereProperty<any> {
    values = values.map((value: string | ObjectID) => {
      return value.toString();
    });
    const rid: string = Text.generateRandomText(10);

    if (!values || values.length === 0) {
      return Raw(() => {
        return `TRUE = TRUE`; // this will always return true
      }, {});
    }

    return Raw(
      (alias: string) => {
        return `(${alias} NOT IN (:...${rid}) or ${alias} IS NULL)`;
      },
      {
        [rid]: values,
      },
    );
  }

  @CaptureSpan()
  public static inRelationArray(
    values: Array<BaseModel | ObjectID>,
  ): Array<any> {
    return values.map((item: BaseModel | ObjectID) => {
      if (item instanceof ObjectID) {
        return item;
      }

      return item.id!;
    });
  }

  @CaptureSpan()
  public static equalTo(value: string): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} = :${rid})`;
      },
      {
        [rid]: value.toString(),
      },
    );
  }

  @CaptureSpan()
  public static greaterThanEqualTo<T extends number | Date>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} >= :${rid})`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static greaterThanEqualToOrNull<T extends number | Date>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} >= :${rid} or ${alias} IS NULL)`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static lessThanEqualTo<T extends number | Date>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} <= :${rid})`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static lessThanOrNull<T extends number | Date>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} < :${rid} or ${alias} IS NULL)`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static lessThanEqualToOrNull<T extends number | Date>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} <= :${rid} or ${alias} IS NULL)`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static greaterThan<T extends number | Date>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} > :${rid})`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static greaterThanOrNull<T extends number | Date>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} >= :${rid} or ${alias} IS NULL)`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static inBetween<T extends number | Date>(
    startValue: T,
    endValue: T,
  ): FindWhereProperty<any> {
    const rid1: string = Text.generateRandomText(10);
    const rid2: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} >= :${rid1} and ${alias} <= :${rid2})`;
      },
      {
        [rid1]: startValue,
        [rid2]: endValue,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static inBetweenOrNull<T extends number | Date>(
    startValue: T,
    endValue: T,
  ): FindWhereProperty<any> {
    const rid1: string = Text.generateRandomText(10);
    const rid2: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(((${alias} >= :${rid1} and ${alias} <= :${rid2})) or (${alias} IS NULL))`;
      },
      {
        [rid1]: startValue,
        [rid2]: endValue,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static notInBetween<T extends number | Date>(
    startValue: T,
    endValue: T,
  ): FindWhereProperty<any> {
    const rid1: string = Text.generateRandomText(10);
    const rid2: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} < :${rid1} or ${alias} > :${rid2})`;
      },
      {
        [rid1]: startValue,
        [rid2]: endValue,
      },
    ) as FindWhereProperty<any>;
  }

  @CaptureSpan()
  public static queryJson(value: JSONObject): FindWhereProperty<any> {
    // seed random text
    const values: JSONObject = {};

    let queryText: string = "";

    if (typeof value === Typeof.String) {
      value = JSON.parse(value.toString());
    }

    if (value instanceof FindOperator) {
      return value;
    }

    const hasValue: boolean = value && Object.keys(value).length > 0;

    for (const key in value) {
      const temp: string = Text.generateRandomText(10);

      values[temp] = value[key];

      if (!queryText) {
        queryText = `(COLUMN_NAME_ALIAS->>'${key}' = :${temp as string}`;
      } else {
        queryText += ` AND COLUMN_NAME_ALIAS->>'${key}' = :${temp as string}`;
      }
    }

    if (hasValue) {
      queryText += ")";
    } else {
      queryText = "(COLUMN_NAME_ALIAS IS NULL OR COLUMN_NAME_ALIAS = '{}')";
    }

    return Raw((alias: string) => {
      // alias is table name + column name like tableName.columnName
      // we need to convert this to "tableName"."columnName"

      alias = alias
        .split(".")
        .map((item: string) => {
          return `"${item}"`;
        })
        .join(".");

      queryText = Text.replaceAll(queryText, "COLUMN_NAME_ALIAS", `${alias}`);
      return queryText;
    }, values);
  }

  @CaptureSpan()
  public static lessThan<T extends number | Date>(
    value: T,
  ): FindWhereProperty<any> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} < :${rid})`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<any>;
  }
}
