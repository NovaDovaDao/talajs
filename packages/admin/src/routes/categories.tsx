import type { Category } from '@talajs/contracts'
import { ListTree, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { ArchiveButton, ArchivedBadge } from '@/components/archive'
import { FormDialog } from '@/components/form-dialog'
import { PageBody, PageHeader } from '@/components/page'
import { EmptyState, ErrorState, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAction, useAll } from '@/lib/queries'
import { useTenant } from '@/lib/session'

const NONE = '__none__'

/** Categories ordered as a tree: parents first, children indented beneath. */
export function categoryTree(categories: Category[]) {
  const byParent = new Map<string | null, Category[]>()
  for (const c of categories) {
    const list = byParent.get(c.parentId) ?? []
    list.push(c)
    byParent.set(c.parentId, list)
  }
  const out: { category: Category; depth: number }[] = []
  const ids = new Set(categories.map((c) => c.id))
  const walk = (parent: string | null, depth: number) => {
    for (const c of (byParent.get(parent) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    )) {
      out.push({ category: c, depth })
      walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
  // Children whose parent is hidden (archived) still show, at the top level.
  for (const c of categories)
    if (c.parentId && !ids.has(c.parentId)) out.push({ category: c, depth: 0 })
  return out
}

function CategoryDialog({
  category,
  all,
  trigger,
}: {
  category?: Category
  all: Category[]
  trigger: React.ReactNode
}) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState(NONE)
  const [sortOrder, setSortOrder] = useState('0')
  const save = useAction(
    (_: void, { api, tenant }) => {
      const body = {
        name,
        parentId: parentId === NONE ? null : parentId,
        sortOrder: Number(sortOrder) || 0,
      }
      return category
        ? api.patch(tenant.path(`/categories/${category.id}`), body)
        : api.post(tenant.path('/categories'), body)
    },
    { success: category ? 'Category updated' : 'Category added' },
  )
  return (
    <FormDialog
      trigger={trigger}
      title={category ? 'Edit category' : 'New category'}
      onOpen={() => {
        setName(category?.name ?? '')
        setParentId(category?.parentId ?? NONE)
        setSortOrder(String(category?.sortOrder ?? 0))
      }}
      pending={save.isPending}
      disabled={!name.trim()}
      onSubmit={() =>
        save
          .mutateAsync()
          .then(() => true)
          .catch(() => false)
      }
    >
      <Field>
        <FieldLabel htmlFor="cat-name">Name</FieldLabel>
        <Input
          id="cat-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Coffee"
        />
      </Field>
      <Field>
        <FieldLabel>Parent</FieldLabel>
        <Select value={parentId} onValueChange={setParentId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None (top level)</SelectItem>
            {all
              .filter((c) => c.id !== category?.id && !c.archivedAt)
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="cat-sort">Sort order</FieldLabel>
        <Input
          id="cat-sort"
          type="number"
          min={0}
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        />
      </Field>
    </FormDialog>
  )
}

export function Categories() {
  const tenant = useTenant()
  const [showArchived, setShowArchived] = useState(false)
  const categories = useAll<Category>('/categories', { includeArchived: showArchived })
  const canEdit = tenant.can('MANAGER')
  const all = categories.data ?? []
  return (
    <>
      <PageHeader
        title="Categories"
        description="Group items on the register and menu."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show archived
            </label>
            {canEdit && (
              <CategoryDialog
                all={all}
                trigger={
                  <Button>
                    <Plus /> New category
                  </Button>
                }
              />
            )}
          </>
        }
      />
      <PageBody>
        {categories.isPending ? (
          <Loading />
        ) : categories.error ? (
          <ErrorState error={categories.error} retry={() => categories.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState
            icon={<ListTree />}
            title="No categories"
            description="Coffee, Tea, Pastries…"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Sort</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {categoryTree(all).map(({ category: c, depth }) => (
                <TableRow key={c.id}>
                  <TableCell
                    className="font-medium"
                    style={{ paddingLeft: `${0.5 + depth * 1.5}rem` }}
                  >
                    {depth > 0 && <span className="mr-1 text-muted-foreground">↳</span>}
                    {c.name} <ArchivedBadge archivedAt={c.archivedAt} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.sortOrder}</TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        <CategoryDialog
                          category={c}
                          all={all}
                          trigger={
                            <Button size="sm" variant="ghost">
                              <Pencil /> Edit
                            </Button>
                          }
                        />
                        <ArchiveButton
                          path={`/categories/${c.id}`}
                          archivedAt={c.archivedAt}
                          noun="Category"
                        />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PageBody>
    </>
  )
}
