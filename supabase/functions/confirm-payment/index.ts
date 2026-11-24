import { serveFunction } from '../_shared/runtime.ts'
import { confirmPayment } from '../_shared/handlers/payments.ts'

Deno.serve(serveFunction('confirm-payment', confirmPayment))
