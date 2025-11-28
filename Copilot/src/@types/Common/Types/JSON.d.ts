declare module "Common/Types/JSON" {
  export type JSONValue =
    | string
    | number
    | boolean
    | null
    | JSONValue[]
    | { [key: string]: JSONValue };

  export interface JSONObject {
    [key: string]: JSONValue;
  }
}
