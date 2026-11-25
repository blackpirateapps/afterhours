"use client";

import {
  ChartNoAxesColumnIncreasing,
  Clock3,
  House,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./ui.module.css";

const routes = [
  { href: "/dashboard", label: "Home", icon: House },
  { href: "/history", label: "History", icon: Clock3 },
  { href: "/stats", label: "Stats", icon: ChartNoAxesColumnIncreasing },
  { href: "/profile", label: "Profile", icon: UserRound },
];

export function Navigation() {
  const path = usePathname();
  return (
    <aside className={styles.sidebar}>
      <Link className={styles.brand} href="/dashboard">
        Afterhours
      </Link>
      <nav aria-label="Main navigation" className={styles.navigation}>
        {routes.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={path === href ? "page" : undefined}
          >
            <Icon aria-hidden="true" size={25} strokeWidth={1.7} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
