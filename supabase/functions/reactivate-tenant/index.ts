import { serveFunction } from '../_shared/runtime.ts'
import { reactivateTenant } from '../_shared/handlers/reactivate-tenant.ts'

Deno.serve(serveFunction('reactivate-tenant', reactivateTenant))
