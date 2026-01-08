import Icon from "../Icon/Icon";
import Link from "../Link/Link";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string;
  route: Route;
  icon: IconProp;
  description: string;
  onClick: () => void;
  iconColor?: string; // Tailwind color name like "blue", "purple", "amber"
}

const NavBarMenuItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // Default to indigo if no color specified
  const colorName: string = props.iconColor || "indigo";

  // Map color names to their respective Tailwind classes
  const colorClasses: Record<
    string,
    { bg: string; ring: string; hoverBg: string; hoverRing: string }
  > = {
    purple: {
      bg: "bg-purple-50",
      ring: "ring-purple-200",
      hoverBg: "hover:bg-purple-50",
      hoverRing: "group-hover:ring-purple-300",
    },
    blue: {
      bg: "bg-blue-50",
      ring: "ring-blue-200",
      hoverBg: "hover:bg-blue-50",
      hoverRing: "group-hover:ring-blue-300",
    },
    gray: {
      bg: "bg-gray-100",
      ring: "ring-gray-300",
      hoverBg: "hover:bg-gray-50",
      hoverRing: "group-hover:ring-gray-400",
    },
    amber: {
      bg: "bg-amber-50",
      ring: "ring-amber-200",
      hoverBg: "hover:bg-amber-50",
      hoverRing: "group-hover:ring-amber-300",
    },
    green: {
      bg: "bg-green-50",
      ring: "ring-green-200",
      hoverBg: "hover:bg-green-50",
      hoverRing: "group-hover:ring-green-300",
    },
    cyan: {
      bg: "bg-cyan-50",
      ring: "ring-cyan-200",
      hoverBg: "hover:bg-cyan-50",
      hoverRing: "group-hover:ring-cyan-300",
    },
    slate: {
      bg: "bg-slate-100",
      ring: "ring-slate-300",
      hoverBg: "hover:bg-slate-50",
      hoverRing: "group-hover:ring-slate-400",
    },
    indigo: {
      bg: "bg-indigo-50",
      ring: "ring-indigo-200",
      hoverBg: "hover:bg-indigo-50",
      hoverRing: "group-hover:ring-indigo-300",
    },
    rose: {
      bg: "bg-rose-50",
      ring: "ring-rose-200",
      hoverBg: "hover:bg-rose-50",
      hoverRing: "group-hover:ring-rose-300",
    },
    violet: {
      bg: "bg-violet-50",
      ring: "ring-violet-200",
      hoverBg: "hover:bg-violet-50",
      hoverRing: "group-hover:ring-violet-300",
    },
  };

  const colors: {
    bg: string;
    ring: string;
    hoverBg: string;
    hoverRing: string;
  } = colorClasses[colorName] || colorClasses["indigo"]!;

  return (
    <div className="dropdown">
      <Link
        onClick={props.onClick}
        to={props.route}
        className={`group flex items-center gap-3 rounded-lg p-2.5 transition-colors ${colors.hoverBg}`}
      >
        <div
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${colors.bg} ring-1 ${colors.ring} ${colors.hoverRing} transition-all`}
        >
          <Icon icon={props.icon} className="h-4 w-4 text-gray-600" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-medium text-gray-900">{props.title}</p>
          <p className="text-xs text-gray-500">{props.description}</p>
        </div>
      </Link>
    </div>
  );
};

export default NavBarMenuItem;
