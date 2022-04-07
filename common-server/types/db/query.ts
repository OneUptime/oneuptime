import { JSONValue } from 'common/types/JSON';

export default interface Query {
    deleted?: boolean;
    projectId?: string;
    [x: string]:
        | JSONValue
        | {
              $regex: RegExp;
              $options: string;
          };
}
