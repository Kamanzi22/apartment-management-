# Manual test checklist (about 10 minutes, on a phone)

Run this after every deploy that touches sign-in, payments, alerts or push.
You need: your phone, the landlord login, and a second email address you can use for a
**test tenant** (for example a Gmail `+test` address).

- Landlord app: https://apartment-manager-landlord.onrender.com
- Tenant app: https://apartment-manager-tenant.onrender.com

Render's free plan sleeps after 15 minutes. The first page can take about a minute to load. That's normal.

Tick each box. If a step fails, write down the step number, what you saw, and the time.

---

## A. Landlord sign-in (1 min)
- [ ] 1. Open the landlord app. You land on the login page, on the **onrender.com** address
      (no redirect loop, no workers.dev).
- [ ] 2. Sign in as the landlord. The dashboard shows **4 vacant units** and no tenants.

## B. Create the test tenant (3 min)
Brevo email isn't set up yet, so "Forgot password" can't send emails. Give the test
tenant a password by **registering it in the tenant app first**, then linking it from the landlord app.

- [ ] 3. In a **private tab**, open the tenant app → switch to the register tab → create an
      account with the test email and a password you'll remember.
      After signing in, it shows **"No unit"**. That's expected.
- [ ] 4. Back in the landlord app: open a vacant unit → **Add Tenant**. Use the **same test email**,
      a move-in date of today, and the unit's rent → **Create Tenant Account**.
      The unit now shows the tenant and their rent.
- [ ] 5. Amounts show as whole **RWF** with separators (for example `RWF 150,000`), never decimals.

## C. Tenant side (3 min)
- [ ] 6. In the private tab, reload the tenant app. Home shows the unit name, the rent and the amount due.
- [ ] 7. **Lease** page shows the move-in date and rent you entered.
- [ ] 8. Submit a small **partial payment** with a receipt photo. It shows as **Pending review**,
      and the receipt opens when you tap it (checks storage file links).
- [ ] 9. Report a **maintenance** request with a photo. The tenant can add a follow-up
      but **can't change the status**.
- [ ] 10. Send the landlord a **message**.

## D. Landlord confirms (1 min)
- [ ] 11. Landlord **Rent** page: the payment is waiting for review, and its receipt opens. Confirm it.
      The tenant's balance goes down by exactly that amount (refresh the tenant tab to check).
- [ ] 12. Landlord **Maintenance**: the request is there with its photo. Change its status.
      The tenant sees the new status.
- [ ] 13. Landlord **Messages**: the tenant's message is there. Reply, and the tenant sees the reply.

## E. Push notifications (2 min)
On iPhone, web push only works when the app is opened **from the Home Screen** (iOS 16.4 or later):
Safari → Share → **Add to Home Screen**, then open it from that icon.
If the button below doesn't appear at all, either the VAPID public key is missing from that
Render service, or the page wasn't opened from the Home Screen icon.

- [ ] 14. Landlord app → **Notifications** → tap **Turn on phone alerts** → allow.
      The button changes to **Phone alerts on**.
- [ ] 15. Tenant app (Home Screen icon, signed in as the test tenant) → **Notifications** →
      **Turn on phone alerts** → allow. It shows **Phone alerts on**.
- [ ] 16. As the tenant, submit another payment or message. The **landlord phone gets a push**
      within a minute.
- [ ] 17. Tap **Phone alerts on** once more. It switches back to **Turn on phone alerts** (turned off).
      Turn it on again if you want to keep alerts.

## F. Clean up (1 min)
- [ ] 18. Landlord: on the test tenant's unit → **Move Out** (today), then **Archive tenant**.
      The unit is vacant again.
- [ ] 19. The tenant tab can no longer sign in (the login is disabled), and the history is still
      visible to the landlord.
- [ ] 20. Sign out of both apps.

---

### Not covered yet (blocked by setup)
- Landlord and tenant **Forgot password** email, and **email alerts**: need Brevo.
- **Google sign-in**: needs the Google OAuth client and the Supabase Google provider.
- **Hourly rent alerts**: these send only during the landlord's send hour. To check them, look at the
  pg_cron `hourly-alerts` run history, or the tenant service logs on Render.
