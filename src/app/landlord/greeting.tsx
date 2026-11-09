'use client'

import { useEffect, useState } from 'react'

function greetingFor(hour: number) {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

// Rendered on the client so the greeting and date follow the viewer's local time.
export function Greeting() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => setNow(new Date()), [])

  return (
    <div>
      <p className="on-photo text-sm font-medium opacity-95" suppressHydrationWarning>
        {now ? now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : ' '}
      </p>
      <h1 className="on-photo text-3xl md:text-4xl font-semibold tracking-tight mt-1" suppressHydrationWarning>
        {now ? greetingFor(now.getHours()) : 'Welcome back'}
      </h1>
    </div>
  )
}
