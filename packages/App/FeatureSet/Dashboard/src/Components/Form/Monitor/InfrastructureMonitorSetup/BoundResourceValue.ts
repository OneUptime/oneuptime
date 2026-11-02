import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * The option a monitor step's resource field shows: the step's value when
 * that is one of the options, else the option of the resource its id is
 * bound to - a cluster renamed, or a host name typed in another case, since
 * the monitor was saved, which the server and the worker follow by its id
 * (InfrastructureResourceBinding). A save from the form then takes that
 * resource's current value. Else the step's own value.
 */
export default function boundResourceValue<T extends { _id?: unknown }>(input: {
  step: { value: string; resourceId?: string | undefined };
  options: Array<DropdownOption>;
  records: Array<T>;
  toOption: (record: T) => DropdownOption;
}): string {
  const isOption: boolean = input.options.some(
    (option: DropdownOption): boolean => {
      return option.value === input.step.value;
    },
  );

  if (isOption || !input.step.resourceId) {
    return input.step.value;
  }

  const bound: T | undefined = input.records.find((record: T): boolean => {
    return Boolean(record._id) && String(record._id) === input.step.resourceId;
  });

  return bound ? String(input.toOption(bound).value) : input.step.value;
}
