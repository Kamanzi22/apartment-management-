// Only for the Node type-check (tsconfig.json here). Deno provides the real ones.
declare namespace Deno {
  export const env: { get(name: string): string | undefined }
  export function serve(handler: (req: Request) => Response | Promise<Response>): unknown
}

declare module 'npm:@supabase/supabase-js@2.108.2' {
  export { createClient } from '@supabase/supabase-js'
}

declare module 'npm:web-push@3.6.7' {
  import webpush from 'web-push'
  export default webpush
}
