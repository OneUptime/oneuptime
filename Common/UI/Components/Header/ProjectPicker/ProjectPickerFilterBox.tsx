import Input from "../../Input/Input";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onChange: (search: string) => void;
}

const ProjectPickerFilterBox: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="px-2 pb-2 mb-1 border-b border-gray-100">
      <label className="sr-only">Search Projects</label>
      <div className="relative">
        <Input
          onChange={(value: string) => {
            props.onChange(value);
          }}
          className="block w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-4 pr-3 text-sm placeholder-gray-400 focus:border-indigo-500 focus:bg-white focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-all duration-150 sm:text-sm"
          placeholder="Search projects..."
        />
      </div>
    </div>
  );
};

export default ProjectPickerFilterBox;
