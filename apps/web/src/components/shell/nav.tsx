"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SECTIONS: Array<{
  label: string;
  items: Array<{ href: string; label: string }>;
}> = [
  {
    label: "Research",
    items: [
      { href: "/videos", label: "Videos" },
      { href: "/sources", label: "Sources" },
      { href: "/add", label: "Add video" },
    ],
  },
  {
    label: "Create",
    items: [
      { href: "/ideas", label: "Ideas" },
      { href: "/hooks", label: "Hook library" },
      { href: "/scripts", label: "Scripts" },
    ],
  },
  {
    label: "Studio",
    items: [
      { href: "/persona", label: "Persona" },
      { href: "/settings", label: "Usage & budget" },
    ],
  },
];

export function ShellNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-6 px-3 py-4">
      {SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="text-sidebar-foreground/50 px-2 pb-1.5 text-[11px] font-medium uppercase tracking-[0.16em]">
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
