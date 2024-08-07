/**
 * GroupBy find options.
 */
declare type GroupBy<Entity> = {
  [P in keyof Entity]?: true;
};

export default GroupBy;
