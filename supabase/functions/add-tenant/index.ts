import { serveFunction } from '../_shared/runtime.ts'
import { addTenant } from '../_shared/handlers/tenancy.ts'

Deno.serve(serveFunction('add-tenant', addTenant))
