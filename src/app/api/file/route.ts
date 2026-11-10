import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isFileBucket } from '@/lib/storage-url'

// Opens a file from a private bucket. The signed URL is created with the
// visitor's own session, so storage RLS decides whether they may see it.
export async function GET(request: NextRequest) {
  const bucket = request.nextUrl.searchParams.get('bucket') ?? ''
  const path = request.nextUrl.searchParams.get('path') ?? ''

  if (!isFileBucket(bucket) || !path || path.includes('..') || path.startsWith('/') || path.includes('\\')) {
    return NextResponse.json({ error: 'Invalid file' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300)
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const response = NextResponse.redirect(data.signedUrl, 302)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
