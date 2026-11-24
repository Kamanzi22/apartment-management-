import { serveFunction } from '../_shared/runtime.ts'
import { deleteAccount } from '../_shared/handlers/delete-account.ts'

Deno.serve(serveFunction('delete-account', deleteAccount))
