import { serveFunction } from '../_shared/runtime.ts'
import { replaceTenancy } from '../_shared/handlers/tenancy.ts'

Deno.serve(serveFunction('replace-tenancy', replaceTenancy))
