import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Text from "Common/Types/Text";
import Typeof from "Common/Types/Typeof";
import { FindOperator, Raw } from "typeorm";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";

export default class QueryHelper {
  public static findWithSameText(text: string | number): FindWhereProperty<any> {
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

  public static isNull(): any {
    return Raw((alias: string) => {
      return `(${alias} IS NULL)`;
    });
  }

  public static notNull(): any {
    return Raw((alias: string) => {
      return `(${alias} IS NOT NULL)`;
    });
  }

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

  public static notIn(values: Array<string | ObjectID>): FindWhereProperty<any> {
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

  public static greaterThanEqualTo<T extends number | Date>(value: T): FindWhereProperty<T> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} >= :${rid})`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<T>;
  }

  public static greaterThanEqualToOrNull<T extends number | Date>(
    value: T,
  ): FindWhereProperty<T> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} >= :${rid} or ${alias} IS NULL)`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<T>;
  }

  public static lessThanEqualTo<T extends number | Date>(value: T): FindWhereProperty<T> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} <= :${rid})`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<T>;
  }

  public static lessThanEqualToOrNull<T extends number | Date>(value: T): FindWhereProperty<T> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} <= :${rid} or ${alias} IS NULL)`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<T>;
  }

  public static greaterThan<T extends number | Date>(value: T): FindWhereProperty< number | Date> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} > :${rid})`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<T>;
  }

  public static greaterThanOrNull<T extends number | Date>(value: T): FindWhereProperty<T> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} <= :${rid} or ${alias} IS NULL)`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<T>;
  }

  public static inBetween<T extends number | Date>(
    startValue: T,
    endValue: T,
  ): FindWhereProperty<T> {
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
    ) as FindWhereProperty<T>;
  }

  public static inBetweenOrNull<T extends number | Date>(
    startValue: T,
    endValue: T,
  ): FindWhereProperty<T> {
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
    ) as FindWhereProperty<T>;
  }

  public static notInBetween<T extends number | Date>(
    startValue: T,
    endValue: T,
  ): FindWhereProperty<T> {
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
    ) as FindWhereProperty<T>;
  }

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

  public static lessThan<T extends number | Date>(value: T): FindWhereProperty<T> {
    const rid: string = Text.generateRandomText(10);
    return Raw(
      (alias: string) => {
        return `(${alias} < :${rid})`;
      },
      {
        [rid]: value,
      },
    ) as FindWhereProperty<T>;
  }
}
