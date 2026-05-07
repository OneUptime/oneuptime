import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
  className?: string | undefined;
}

type Category =
  | "public"
  | "private"
  | "mesh"
  | "cgnat"
  | "linklocal"
  | "loopback";

interface CategoryMeta {
  title: string;
  description: string;
  icon: IconProp;
  iconClass: string;
  chipClass: string;
}

const CATEGORY_META: Record<Category, CategoryMeta> = {
  public: {
    title: "Public",
    description: "Reachable from the internet.",
    icon: IconProp.Globe,
    iconClass: "text-emerald-600 bg-emerald-50 ring-emerald-200",
    chipClass:
      "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200",
  },
  private: {
    title: "Private LAN",
    description: "Local network — RFC1918.",
    icon: IconProp.Home,
    iconClass: "text-indigo-600 bg-indigo-50 ring-indigo-200",
    chipClass: "bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200",
  },
  mesh: {
    title: "Mesh / VPN",
    description: "Private overlay network — ULA (fc00::/7).",
    icon: IconProp.ServerStack,
    iconClass: "text-violet-600 bg-violet-50 ring-violet-200",
    chipClass: "bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-200",
  },
  cgnat: {
    title: "Carrier NAT",
    description: "Shared with the ISP — 100.64.0.0/10 (CGNAT).",
    icon: IconProp.Cloud,
    iconClass: "text-amber-600 bg-amber-50 ring-amber-200",
    chipClass: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
  },
  linklocal: {
    title: "Link-local",
    description: "Auto-assigned per interface — only valid on the local link.",
    icon: IconProp.Link,
    iconClass: "text-gray-600 bg-gray-100 ring-gray-200",
    chipClass: "bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200",
  },
  loopback: {
    title: "Loopback",
    description: "Local machine only.",
    icon: IconProp.Lock,
    iconClass: "text-gray-600 bg-gray-100 ring-gray-200",
    chipClass: "bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200",
  },
};

const CATEGORY_ORDER: Array<Category> = [
  "public",
  "private",
  "mesh",
  "cgnat",
  "linklocal",
  "loopback",
];

const ULA_REGEX: RegExp = /^f[cd][0-9a-f]/iu;
const PUBLIC_V6_REGEX: RegExp = /^[23][0-9a-f]*:/iu;
const SITE_LOCAL_V6_REGEX: RegExp = /^fec[0-9a-f]:/iu;

const classifyIp: (ip: string) => Category = (ip: string): Category => {
  const lower: string = ip.toLowerCase().trim();

  if (lower.includes(".") && !lower.includes(":")) {
    const parts: Array<number> = lower.split(".").map((p: string): number => {
      return Number(p);
    });
    if (
      parts.length !== 4 ||
      parts.some((p: number): boolean => {
        return isNaN(p);
      })
    ) {
      return "public";
    }
    const a: number = parts[0]!;
    const b: number = parts[1]!;
    if (a === 127) {
      return "loopback";
    }
    if (a === 10) {
      return "private";
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return "private";
    }
    if (a === 192 && b === 168) {
      return "private";
    }
    if (a === 100 && b >= 64 && b <= 127) {
      return "cgnat";
    }
    if (a === 169 && b === 254) {
      return "linklocal";
    }
    return "public";
  }

  if (lower === "::1") {
    return "loopback";
  }
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) {
    return "linklocal";
  }
  if (ULA_REGEX.test(lower)) {
    return "mesh";
  }
  if (SITE_LOCAL_V6_REGEX.test(lower)) {
    return "mesh";
  }
  if (PUBLIC_V6_REGEX.test(lower)) {
    return "public";
  }
  return "public";
};

const IpAddressList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const ipString: string = props.text || "";
  if (!ipString) {
    return <span className="text-sm text-gray-400">—</span>;
  }

  const seen: Set<string> = new Set<string>();
  const ips: Array<string> = [];
  for (const raw of ipString.split(",")) {
    const trimmed: string = raw.trim();
    if (!trimmed) {
      continue;
    }
    const key: string = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    ips.push(trimmed);
  }

  if (ips.length === 0) {
    return <span className="text-sm text-gray-400">—</span>;
  }

  const grouped: Map<Category, Array<string>> = new Map<
    Category,
    Array<string>
  >();
  for (const ip of ips) {
    const cat: Category = classifyIp(ip);
    const list: Array<string> = grouped.get(cat) || [];
    list.push(ip);
    grouped.set(cat, list);
  }

  const sections: Array<{ category: Category; ips: Array<string> }> = [];
  for (const cat of CATEGORY_ORDER) {
    const list: Array<string> | undefined = grouped.get(cat);
    if (list && list.length > 0) {
      sections.push({ category: cat, ips: list });
    }
  }

  return (
    <div className={`flex flex-col gap-4 min-w-0 ${props.className || ""}`}>
      {sections.map(
        (section: { category: Category; ips: Array<string> }): ReactElement => {
          const meta: CategoryMeta = CATEGORY_META[section.category];
          return (
            <div key={section.category} className="flex flex-col gap-2">
              <div className="flex items-start gap-2.5">
                <div
                  className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${meta.iconClass}`}
                >
                  <Icon icon={meta.icon} className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {meta.title}
                    </span>
                    <span className="text-xs text-gray-500">
                      {section.ips.length}
                      {section.ips.length === 1 ? " address" : " addresses"}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {meta.description}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 pl-9">
                {section.ips.map((ip: string): ReactElement => {
                  return (
                    <span
                      key={ip}
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-mono ${meta.chipClass}`}
                    >
                      {ip}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        },
      )}
    </div>
  );
};

export default IpAddressList;
