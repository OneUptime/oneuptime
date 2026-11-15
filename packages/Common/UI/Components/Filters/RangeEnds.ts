import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * THE TWO ENDS OF A RANGE (#8201).
 *
 * A date or number filter's "is between", a custom time range, a dashboard's
 * time range and a facet's date range name their two fields, and the two
 * lines that repeat what was picked, From and To. A key is its English text,
 * and the bare "From" and "To" are a message's sender and recipient (the
 * notification logs' To and From columns), so most languages worded them so:
 * a German filter read "Von" ... "An" (to someone), a Japanese one 差出人
 * (sender) ... 宛先 (addressee), a Korean one 보낸 사람 ... 받는 사람.
 *
 * A range's ends have keys of their own, listed in Common/Types/MeaningKeys
 * and worded as the start and end of a span in every language ("Von" ...
 * "Bis", 開始 ... 終了). English reads them as "From" and "To".
 */
export const RANGE_START: string = translationKey("From (range start)");
export const RANGE_END: string = translationKey("To (range end)");
