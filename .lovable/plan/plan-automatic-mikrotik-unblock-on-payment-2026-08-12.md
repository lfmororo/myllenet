# Plan: Automatic Mikrotik Unblock on Payment

Implement logic to automatically unblock customers in Mikrotik when they pay an invoice, provided they have no other overdue charges.

## User Review Required

> [!IMPORTANT]
> The system will automatically unblock the client only if **all** pending/overdue invoices are cleared. If a client pays one invoice but has others still overdue, they will remain blocked.

## Proposed Changes

### Edge Functions

#### `supabase/functions/efi-boleto/index.ts`
- Modify `sendPaymentNotification` (or create a new helper) to trigger a Mikrotik unblock check.
- In `sendPaymentNotification`, after confirming payment:
    1. Check if the customer has any other invoices with status 'pending' or 'overdue' that are past their due date.
    2. If no other overdue invoices exist, update `customers.block_status` to 'active'.
    3. Log the change in `block_history`.
    4. Invoke `mikrotik-customer` Edge Function with the `enable` action to sync the change to the router.

### Technical Details
- The unblock logic will be integrated into the payment reconciliation flow (both manual check and bulk check).
- It will verify the `block_status` of the customer before acting to avoid redundant syncs.
- It will use the existing `mikrotik-customer` Edge Function via internal invocation to ensure consistent Mikrotik interaction logic.
