/*
 * How a manual balance adjustment is applied. Add and Deduct are relative and
 * land as a single atomic SQL delta, so they cannot lose a usage charge that
 * is being written at the same moment. Set is absolute - last writer wins -
 * and is only there for the case where staff need the balance to read a
 * specific number regardless of what it holds now.
 */
enum BalanceAdjustmentType {
  Add = "Add",
  Deduct = "Deduct",
  Set = "Set",
}

export default BalanceAdjustmentType;
