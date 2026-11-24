import type { ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="h-5" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-heading text-lg font-semibold">{title}</h1>
        {description && <p className="truncate text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function PageBody({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`flex flex-1 flex-col gap-4 p-4 ${className}`}>{children}</div>
}
