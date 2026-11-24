import { serveFunction } from '../_shared/runtime.ts'
import { notify } from '../_shared/handlers/notify.ts'

Deno.serve(serveFunction('notify', notify))
