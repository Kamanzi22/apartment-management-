import { cn } from '@/lib/utils'

function Bar({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

// Generic placeholder shown by route-level loading.tsx files while a page's
// server data is being fetched. Rendered inside the layout, so the nav stays put.
export function PageSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Bar className="h-7 w-48" />
        <Bar className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="rounded-xl border p-4 space-y-3">
            <Bar className="h-5 w-32" />
            <Bar className="h-4 w-full" />
            <Bar className="h-4 w-2/3" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border p-4 space-y-3">
        <Bar className="h-5 w-40" />
        <Bar className="h-4 w-full" />
        <Bar className="h-4 w-full" />
        <Bar className="h-4 w-1/2" />
      </div>
    </div>
  )
}
