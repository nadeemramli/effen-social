"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Must be a descendant of <Link> for useLinkStatus to report its status. */
function NavLinkLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return (
    <span className="flex items-center justify-between gap-2">
      <span>{label}</span>
      {pending && (
        <span
          className="border-sidebar-foreground/40 border-t-sidebar-foreground size-3 shrink-0 animate-spin rounded-full border-[1.5px]"
          aria-hidden
        />
      )}
    </span>
  );
}

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
                    <NavLinkLabel label={item.label} />
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
