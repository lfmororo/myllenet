-- Function to handle block status change alerts
CREATE OR REPLACE FUNCTION public.handle_block_status_change()
RETURNS TRIGGER AS $$
DECLARE
    v_customer_name text;
    v_customer_phone text;
    v_message text;
    v_webhook_url text;
    v_service_key text;
BEGIN
    IF (OLD.block_status IS DISTINCT FROM NEW.block_status) THEN
        -- Get customer info
        SELECT nome, telefone INTO v_customer_name, v_customer_phone 
        FROM public.customers 
        WHERE id = NEW.id;

        IF v_customer_phone IS NOT NULL AND NEW.alert_on_block_change = true THEN
            -- Avoid spam: check if we already sent an alert for this status change in the last hour
            IF NOT EXISTS (
                SELECT 1 FROM public.block_alerts_sent 
                WHERE customer_id = NEW.id 
                AND old_status = OLD.block_status 
                AND new_status = NEW.block_status
                AND sent_at > now() - interval '1 hour'
            ) THEN
                
                IF NEW.block_status = 'blocked' THEN
                    v_message := '⚠️ *Aviso de Bloqueio:* Olá ' || v_customer_name || ', identificamos uma fatura com mais de 15 dias de atraso e seu sinal foi suspenso automaticamente. Regularize para restabelecer a conexão.';
                ELSE
                    v_message := '✅ *Sinal Liberado:* Olá ' || v_customer_name || ', seu pagamento foi identificado e seu sinal já foi liberado no sistema. Obrigado!';
                END IF;

                -- Record the alert
                INSERT INTO public.block_alerts_sent (customer_id, old_status, new_status)
                VALUES (NEW.id, OLD.block_status, NEW.block_status);

                -- Trigger WhatsApp notification via Edge Function
                -- We use net.http_post if extensions are available, or let the app poll/webhook handle it.
                -- For now, we'll log it for the next edge function run to pick up if needed, 
                -- or use a direct call if vault/secrets are accessible.
                -- Since we can't easily call Edge Functions from SQL without specific setup,
                -- we'll rely on a new check in the daily or 15min sync.
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for block status changes
DROP TRIGGER IF EXISTS on_block_status_change ON public.customers;
CREATE TRIGGER on_block_status_change
    AFTER UPDATE OF block_status ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_block_status_change();
