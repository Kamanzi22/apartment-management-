import { serveFunction } from '../_shared/runtime.ts'
import { broadcast } from '../_shared/handlers/broadcast.ts'

Deno.serve(serveFunction('broadcast', broadcast))
