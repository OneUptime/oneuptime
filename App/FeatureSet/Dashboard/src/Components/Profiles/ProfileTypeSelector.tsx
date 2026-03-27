import React, { FunctionComponent, ReactElement } from "react";

export interface ProfileTypeSelectorProps {
  selectedProfileType: string | undefined;
  onChange: (profileType: string | undefined) => void;
}

interface ProfileTypeOption {
  label: string;
  value: string | undefined;
}

const profileTypeOptions: Array<ProfileTypeOption> = [
  { label: "All Types", value: undefined },
  { label: "CPU", value: "cpu" },
  { label: "Wall", value: "wall" },
  { label: "Alloc Objects", value: "alloc_objects" },
  { label: "Alloc Space", value: "alloc_space" },
  { label: "Goroutine", value: "goroutine" },
  { label: "Contention", value: "contention" },
];

const ProfileTypeSelector: FunctionComponent<ProfileTypeSelectorProps> = (
  props: ProfileTypeSelectorProps,
): ReactElement => {
  return (
    <div className="flex items-center space-x-2">
      <label className="text-sm font-medium text-gray-700">Profile Type:</label>
      <select
        className="px-3 py-1.5 text-sm border border-gray-300 rounded bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        value={props.selectedProfileType || ""}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
          const value: string = e.target.value;
          props.onChange(value === "" ? undefined : value);
        }}
      >
        {profileTypeOptions.map((option: ProfileTypeOption, index: number) => {
          return (
            <option key={index} value={option.value || ""}>
              {option.label}
            </option>
          );
        })}
      </select>
    </div>
  );
};

export default ProfileTypeSelector;
