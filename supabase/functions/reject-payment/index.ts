import { serveFunction } from '../_shared/runtime.ts'
import { rejectPayment } from '../_shared/handlers/payments.ts'

Deno.serve(serveFunction('reject-payment', rejectPayment))
