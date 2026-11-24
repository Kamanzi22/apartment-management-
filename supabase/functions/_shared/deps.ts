// The only file with remote (npm:) imports. Versions are pinned to what the
// web apps use. Deno-only: excluded from the Node type-check and from vitest.
export { createClient } from 'npm:@supabase/supabase-js@2.108.2'
export { default as webpush } from 'npm:web-push@3.6.7'
