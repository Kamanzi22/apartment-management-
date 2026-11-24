import { serveFunction } from '../_shared/runtime.ts'
import { resetTenantPassword } from '../_shared/handlers/reset-tenant-password.ts'

Deno.serve(serveFunction('reset-tenant-password', resetTenantPassword))
