"use client";

import {
  AppShell,
  BrandMark,
  Breadcrumbs,
  Sidebar,
  UserMenu,
  activeFor,
  useAppearance,
  useRailState,
  type NavModel,
  type UserMenuItem,
} from "@calliopelabs/ui";
import { GalleryVerticalEndIcon } from "lucide-react";
import type { ReactNode } from "react";

import { crumbsFor } from "@/ui-app/shell/crumbs";

export interface AppFrameProps {
  /** The navigation the viewer may open, already translated. */
  nav: NavModel;
  pathname: string;
  user: { name: string; email: string };
  /** The user menu's items, in groups separated by rules. */
  menu?: readonly (readonly UserMenuItem[])[];
  onSignOut: () => void;
  /** Names the last crumb when a page sits below its sidebar row. */
  pageLabel?: (segment: string) => string;
  /** The right rail: the assistant, when there is one (components/AppChrome.tsx). */
  rightRail?: ReactNode;
  rightRailLabel?: string;
  /** `]` toggles the right rail. */
  onToggleRightRail?: () => void;
  children: ReactNode;
}

const capitalize = (segment: string) =>
  segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");

const Mark = () => <GalleryVerticalEndIcon aria-hidden className="size-5" />;

/**
 * The signed-in frame: the library's AppShell with the product's sidebar,
 * brand mark and user menu, the breadcrumb above the content, and the
 * assistant's rail when the caller gives one. Pure: the
 * person, the navigation and sign-out come from the caller
 * (components/AppChrome.tsx), so the catalog renders it with fixtures.
 */
export function AppFrame({
  nav,
  pathname,
  user,
  menu,
  onSignOut,
  pageLabel = capitalize,
  rightRail,
  rightRailLabel,
  onToggleRightRail,
  children,
}: AppFrameProps) {
  const { product } = useAppearance();
  const [collapsed, setCollapsed] = useRailState(`${product.id}.shell.main`);
  const crumbs = crumbsFor(nav, pathname, pageLabel);
  const rail: { rightRail: ReactNode; rightRailLabel: string } | { rightRail?: undefined } =
    rightRail ? { rightRail, rightRailLabel: rightRailLabel ?? "" } : {};

  return (
    <AppShell
      onToggleSidebar={() => setCollapsed(!collapsed)}
      {...rail}
      onToggleRightRail={onToggleRightRail}
      header={crumbs.length > 0 ? <Breadcrumbs crumbs={crumbs} /> : undefined}
      sidebar={
        <Sidebar
          nav={nav}
          active={activeFor(nav, pathname)}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          header={<BrandMark href="/dashboard" mark={<Mark />} />}
          headerCollapsed={<BrandMark href="/dashboard" mark={<Mark />} collapsed />}
          footer={
            <UserMenu name={user.name} email={user.email} groups={menu} onSignOut={onSignOut} />
          }
        />
      }
    >
      {children}
    </AppShell>
  );
}
