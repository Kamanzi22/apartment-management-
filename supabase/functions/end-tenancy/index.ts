import { serveFunction } from '../_shared/runtime.ts'
import { endTenancy } from '../_shared/handlers/tenancy.ts'

Deno.serve(serveFunction('end-tenancy', endTenancy))
