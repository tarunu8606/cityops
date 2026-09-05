"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/map", label: "Map" },
  { href: "/conflicts", label: "Conflicts" },
  { href: "/simulation", label: "Simulation" },
];

export default function NavShell() {
  const pathname = usePathname();

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-6">
      <span className="mr-8 text-sm font-semibold tracking-wide text-slate-800">
        CityOps
      </span>
      <nav className="flex h-full items-stretch gap-1">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center px-3 text-sm font-medium transition-colors duration-150 ${
                active ? "text-[#0E7A85]" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {item.label}
              {active && (
                <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[#0E7A85]" />
              )}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
