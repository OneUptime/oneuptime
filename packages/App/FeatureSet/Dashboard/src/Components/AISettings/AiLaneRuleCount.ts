import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Query from "Common/Types/BaseDatabase/Query";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * How many enabled rules of one kind a lane has: the ones that decide
 * anything, since a disabled rule narrows nothing. The folded More settings
 * header draws a rules table with any as a chip ("Investigation rules: 2").
 *
 * Read after every read of the table rather than taken from it: a table
 * counts the rows its filters let through, disabled ones included.
 */
export type ReadEnabledAiLaneRuleCountFunction = <
  TRule extends BaseModel,
>(data: {
  modelType: { new (): TRule };
  triggerEntityType: string;
}) => Promise<number>;

export const readEnabledAiLaneRuleCount: ReadEnabledAiLaneRuleCountFunction =
  async <TRule extends BaseModel>(data: {
    modelType: { new (): TRule };
    triggerEntityType: string;
  }): Promise<number> => {
    return await ModelAPI.count<TRule>({
      modelType: data.modelType,
      query: {
        triggerEntityType: data.triggerEntityType,
        isEnabled: true,
      } as unknown as Query<TRule>,
    });
  };

/*
 * What a rules table hands its page after each read: the count, or nothing
 * when it cannot be read - the header then just does not say.
 */
export const reportEnabledAiLaneRuleCount: <TRule extends BaseModel>(data: {
  modelType: { new (): TRule };
  triggerEntityType: string;
  onRulesLoaded?: ((count: number) => void) | undefined;
}) => Promise<void> = async <TRule extends BaseModel>(data: {
  modelType: { new (): TRule };
  triggerEntityType: string;
  onRulesLoaded?: ((count: number) => void) | undefined;
}): Promise<void> => {
  if (!data.onRulesLoaded) {
    return;
  }

  try {
    data.onRulesLoaded(
      await readEnabledAiLaneRuleCount<TRule>({
        modelType: data.modelType,
        triggerEntityType: data.triggerEntityType,
      }),
    );
  } catch {
    // The rules still show in the table; only the folded header is quiet.
  }
};
