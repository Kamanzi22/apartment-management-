// Kept identical in apartment-manager and apartment-manager-tenant.
//
// All storage buckets are private, so a public URL never opens. The database
// stores the bare object path (older rows hold a getPublicUrl() link); pages
// link to /api/file, which checks the session and redirects to a short-lived
// signed URL.

export const FILE_BUCKETS = ['receipts', 'maintenance-photos', 'expense-receipts'] as const
export type FileBucket = (typeof FILE_BUCKETS)[number]

export function isFileBucket(value: string): value is FileBucket {
  return (FILE_BUCKETS as readonly string[]).includes(value)
}

/** The object path inside `bucket`, from either a bare path or an old Supabase storage URL. */
export function storagePath(bucket: FileBucket, stored: string | null | undefined): string | null {
  if (!stored) return null
  const value = stored.trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) {
    let pathname: string
    try {
      pathname = new URL(value).pathname
    } catch {
      return null
    }
    for (const kind of ['public', 'sign', 'authenticated']) {
      const marker = `/storage/v1/object/${kind}/${bucket}/`
      const i = pathname.indexOf(marker)
      if (i >= 0) return decodeURIComponent(pathname.slice(i + marker.length)) || null
    }
    return null
  }
  return value.replace(/^\/+/, '') || null
}

/** Link that opens a stored file through /api/file. Null when there is no file. */
export function fileUrl(bucket: FileBucket, stored: string | null | undefined): string | null {
  const path = storagePath(bucket, stored)
  if (!path) return null
  return `/api/file?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`
}

/** True when the stored file looks like a PDF (for choosing <iframe> over <img>). */
export function isPdf(stored: string | null | undefined): boolean {
  return !!stored && /\.pdf($|\?)/i.test(stored)
}
