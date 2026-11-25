import type { MemberRole } from '@talajs/contracts'
import {
  Boxes,
  Building2,
  Check,
  ChevronsUpDown,
  ClipboardList,
  Coffee,
  Gauge,
  LayoutGrid,
  ListTree,
  LogOut,
  Monitor,
  Moon,
  Percent,
  ReceiptText,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Sun,
  TriangleAlert,
  UserRound,
  Users,
  UsersRound,
} from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { useTheme } from '@/components/theme-provider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
} from '@/components/ui/sidebar'
import { useApp, useTenant } from '@/lib/session'

interface NavItem {
  to: string
  label: string
  icon: typeof Gauge
  role: MemberRole
  /** Only for members with access to every store. */
  allStores?: boolean
}

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: 'Sell',
    items: [
      { to: '', label: 'Overview', icon: Gauge, role: 'STAFF' },
      { to: 'register', label: 'Register', icon: Coffee, role: 'STAFF' },
      { to: 'orders', label: 'Orders & tabs', icon: ReceiptText, role: 'STAFF' },
      { to: 'customers', label: 'Customers', icon: UsersRound, role: 'STAFF' },
    ],
  },
  {
    label: 'Menu',
    items: [
      { to: 'items', label: 'Items', icon: LayoutGrid, role: 'STAFF' },
      { to: 'categories', label: 'Categories', icon: ListTree, role: 'STAFF' },
      { to: 'modifier-groups', label: 'Modifiers', icon: SlidersHorizontal, role: 'STAFF' },
      { to: 'tax-rates', label: 'Tax rates', icon: Percent, role: 'STAFF' },
    ],
  },
  {
    label: 'Operate',
    items: [
      { to: 'inventory', label: 'Inventory', icon: Boxes, role: 'STAFF' },
      { to: 'stores', label: 'Stores', icon: Store, role: 'STAFF' },
      { to: 'terminals', label: 'Registers', icon: Monitor, role: 'MANAGER' },
      {
        to: 'review',
        label: 'Review queue',
        icon: TriangleAlert,
        role: 'MANAGER',
        allStores: true,
      },
      { to: 'members', label: 'Team', icon: Users, role: 'MANAGER' },
    ],
  },
]

function StoreSwitcher() {
  const { stores, storeId, setStoreId } = useTenant()
  if (stores.length === 0) return null
  return (
    <Select value={storeId ?? undefined} onValueChange={setStoreId}>
      <SelectTrigger className="w-full" aria-label="Store">
        <SelectValue placeholder="Choose a store" />
      </SelectTrigger>
      <SelectContent>
        {stores.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function UserMenu() {
  const { auth } = useApp()
  const { displayName, role, tenantName, tenantId, memberships } = useTenant()
  const { setTheme } = useTheme()
  const navigate = useNavigate()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg">
          <ShieldCheck />
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{displayName}</span>
            <span className="truncate text-xs text-muted-foreground">{role.toLowerCase()}</span>
          </div>
          <ChevronsUpDown className="ml-auto" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuItem onSelect={() => navigate(`/t/${tenantId}/account`)}>
          <UserRound /> Your account
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Businesses</DropdownMenuLabel>
        {memberships.length > 1 ? (
          memberships.map((m) => (
            <DropdownMenuItem key={m.tenantId} onSelect={() => navigate(`/t/${m.tenantId}`)}>
              {m.tenantId === tenantId ? <Check /> : <Building2 />}
              <span className="truncate">{m.tenantName}</span>
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>
            <Check /> <span className="truncate">{tenantName}</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => navigate('/')}>
          <ClipboardList /> All businesses
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setTheme('light')}>
          <Sun /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('dark')}>
          <Moon /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('system')}>
          <Monitor /> System
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await auth.signOut()
            navigate('/sign-in')
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppShell() {
  const tenant = useTenant()
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 py-1.5 group-data-[collapsible=icon]:hidden">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary font-heading text-sm font-bold text-primary-foreground">
              T
            </div>
            <span className="truncate font-heading font-semibold">{tenant.tenantName}</span>
          </div>
          <div className="group-data-[collapsible=icon]:hidden">
            <StoreSwitcher />
          </div>
        </SidebarHeader>
        <SidebarContent>
          {NAV.map((group) => {
            const items = group.items.filter(
              (i) => tenant.can(i.role) && (!i.allStores || tenant.storeIds.length === 0),
            )
            if (items.length === 0) return null
            return (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {items.map((item) => (
                      <SidebarMenuItem key={item.to}>
                        <NavLink to={item.to} end={item.to === ''}>
                          {({ isActive }) => (
                            <SidebarMenuButton isActive={isActive} tooltip={item.label}>
                              <item.icon />
                              <span>{item.label}</span>
                            </SidebarMenuButton>
                          )}
                        </NavLink>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )
          })}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <UserMenu />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
