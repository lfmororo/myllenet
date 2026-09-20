CREATE POLICY "Report users can read customers"
ON public.customers FOR SELECT TO authenticated
USING (
  public.has_report_access(auth.uid(), 'overdue') OR
  public.has_report_access(auth.uid(), 'blocked') OR
  public.has_report_access(auth.uid(), 'customers') OR
  public.has_report_access(auth.uid(), 'bandwidth') OR
  public.has_report_access(auth.uid(), 'missing_invoice')
);

CREATE POLICY "Report users can read invoices"
ON public.invoices FOR SELECT TO authenticated
USING (
  public.has_report_access(auth.uid(), 'overdue') OR
  public.has_report_access(auth.uid(), 'blocked') OR
  public.has_report_access(auth.uid(), 'financial') OR
  public.has_report_access(auth.uid(), 'missing_invoice') OR
  public.has_report_access(auth.uid(), 'platforms')
);

CREATE POLICY "Report users can read plans"
ON public.plans FOR SELECT TO authenticated
USING (
  public.has_report_access(auth.uid(), 'overdue') OR
  public.has_report_access(auth.uid(), 'blocked') OR
  public.has_report_access(auth.uid(), 'customers') OR
  public.has_report_access(auth.uid(), 'financial') OR
  public.has_report_access(auth.uid(), 'bandwidth') OR
  public.has_report_access(auth.uid(), 'missing_invoice') OR
  public.has_report_access(auth.uid(), 'platforms')
);

CREATE POLICY "Bandwidth report users can read PPPoE logs"
ON public.pppoe_logs FOR SELECT TO authenticated
USING (public.has_report_access(auth.uid(), 'bandwidth'));

CREATE POLICY "Blocked report users can read block history"
ON public.block_history FOR SELECT TO authenticated
USING (public.has_report_access(auth.uid(), 'blocked'));