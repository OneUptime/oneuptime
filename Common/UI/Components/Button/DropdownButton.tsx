import React, { ReactElement, useState } from "react";

interface DropdownOption {
  label: string;
  onClick: () => void;
}

interface DropdownButtonProps {
  title: string;
  dropdownOptions: DropdownOption[];
  onButtonClick: () => void;
}

export interface ComponentProps {
  title: string;
  dropdownOptions: DropdownOption[];
  onButtonClick: () => void;
}

const DropdownButton: React.FC<DropdownButtonProps> = ({
  title,
  dropdownOptions,
  onButtonClick,
}: ComponentProps): ReactElement => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleDropdown: VoidFunction = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className="inline-flex rounded-md shadow-sm">
      <button
        type="button"
        className="relative inline-flex items-center rounded-l-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-10"
        onClick={onButtonClick}
      >
        {title}
      </button>
      <div className="relative -ml-px block">
        <button
          type="button"
          className="relative inline-flex items-center rounded-r-md bg-white px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-10"
          id="option-menu-button"
          aria-expanded={isOpen}
          aria-haspopup="true"
          onClick={toggleDropdown}
        >
          <span className="sr-only">Open options</span>
          <svg
            className="size-5"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {isOpen && (
          <div
            className="absolute right-0 z-10 -mr-1 mt-2 w-56 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black/5 focus:outline-none"
            role="menu"
            aria-orientation="vertical"
            aria-labelledby="option-menu-button"
          >
            <div className="py-1" role="none">
              {dropdownOptions.map((option: DropdownOption, index: number) => {
                return (
                  <a
                    key={index}
                    href="#"
                    className="block px-4 py-2 text-sm text-gray-700"
                    role="menuitem"
                    onClick={option.onClick}
                  >
                    {option.label}
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DropdownButton;
