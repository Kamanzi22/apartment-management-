import { serveFunction } from '../_shared/runtime.ts'
import { phoneSignIn } from '../_shared/handlers/phone-sign-in.ts'

Deno.serve(serveFunction('phone-sign-in', phoneSignIn))
