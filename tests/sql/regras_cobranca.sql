-- Testes das regras de bloqueio e aviso de corte, no banco real, dentro de uma transação
-- que é DESFEITA no final (rollback): nada é gravado, nenhum WhatsApp sai, o roteador não muda.
-- Rodar com: deploy/vpsfaedi/17-manutencao.sh  (ou psql -f, como supabase_admin)
begin;

create temp table _resultado (teste text, ok boolean, detalhe text) on commit drop;

do $$
declare
  hoje date := public.hoje_local();
  modelo_c jsonb;
  modelo_i jsonb;
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  d uuid := gen_random_uuid(); e uuid := gen_random_uuid(); f uuid := gen_random_uuid();
  st text;
begin
  update public.settings set value = '15' where key = 'blocking_days';
  insert into public.settings (key, value) select 'blocking_days', '15'
    where not exists (select 1 from public.settings where key = 'blocking_days');
  update public.settings set value = '5' where key = 'aviso_corte_dias_antes';

  -- modelos a partir de linhas reais (cobre colunas obrigatórias), com campos únicos limpos
  select to_jsonb(x) into modelo_c from public.customers x limit 1;
  select to_jsonb(x) into modelo_i from public.invoices x limit 1;
  if modelo_c is null or modelo_i is null then
    insert into _resultado values ('preparação', false, 'banco sem clientes/faturas para servir de modelo');
    return;
  end if;

  modelo_c := modelo_c || jsonb_build_object('usuario_pppoe', null, 'diagnostico_token', null, 'email', null);
  insert into public.customers
  select * from jsonb_populate_recordset(null::public.customers, jsonb_build_array(
    modelo_c || jsonb_build_object('id', a, 'nome', 'TESTE A 15 dias', 'ativo', true, 'block_status', 'active', 'cpf', '90000000001'),
    modelo_c || jsonb_build_object('id', b, 'nome', 'TESTE B 14 dias', 'ativo', true, 'block_status', 'active', 'cpf', '90000000002'),
    modelo_c || jsonb_build_object('id', c, 'nome', 'TESTE C paga', 'ativo', true, 'block_status', 'active', 'cpf', '90000000003'),
    modelo_c || jsonb_build_object('id', d, 'nome', 'TESTE D bloqueado pagou', 'ativo', true, 'block_status', 'blocked', 'cpf', '90000000004'),
    modelo_c || jsonb_build_object('id', e, 'nome', 'TESTE E inativo', 'ativo', false, 'block_status', 'active', 'cpf', '90000000005'),
    modelo_c || jsonb_build_object('id', f, 'nome', 'TESTE F 10 dias', 'ativo', true, 'block_status', 'active', 'cpf', '90000000006')
  ));

  -- faturas do teste
  insert into public.invoices
  select * from jsonb_populate_recordset(null::public.invoices, jsonb_build_array(
    modelo_i || jsonb_build_object('id', gen_random_uuid(), 'customer_id', a, 'status', 'pending', 'vencimento', hoje - 15, 'valor_centavos', 9990),
    modelo_i || jsonb_build_object('id', gen_random_uuid(), 'customer_id', b, 'status', 'overdue', 'vencimento', hoje - 14, 'valor_centavos', 9990),
    modelo_i || jsonb_build_object('id', gen_random_uuid(), 'customer_id', c, 'status', 'paid',    'vencimento', hoje - 30, 'valor_centavos', 9990),
    modelo_i || jsonb_build_object('id', gen_random_uuid(), 'customer_id', d, 'status', 'paid',    'vencimento', hoje - 40, 'valor_centavos', 9990),
    modelo_i || jsonb_build_object('id', gen_random_uuid(), 'customer_id', e, 'status', 'pending', 'vencimento', hoje - 40, 'valor_centavos', 9990),
    modelo_i || jsonb_build_object('id', gen_random_uuid(), 'customer_id', f, 'status', 'pending', 'vencimento', hoje - 10, 'valor_centavos', 9990)
  ));

  -- prévia: quem será bloqueado hoje às 23h e amanhã
  insert into _resultado select 'prévia hoje inclui A (15 dias)', exists(select 1 from public.clientes_a_bloquear(hoje) where customer_id = a), '';
  insert into _resultado select 'prévia hoje NÃO inclui B (14 dias)', not exists(select 1 from public.clientes_a_bloquear(hoje) where customer_id = b), '';
  insert into _resultado select 'prévia amanhã inclui B', exists(select 1 from public.clientes_a_bloquear(hoje + 1) where customer_id = b), '';
  insert into _resultado select 'prévia nunca inclui C (paga)', not exists(select 1 from public.clientes_a_bloquear(hoje + 30) where customer_id = c), '';
  insert into _resultado select 'prévia nunca inclui E (inativo)', not exists(select 1 from public.clientes_a_bloquear(hoje) where customer_id = e), '';
  -- aviso de corte (5 dias antes): F (10 dias) entra hoje na lista de daqui a 5 dias, e não estava na de 4
  insert into _resultado select 'aviso de corte: F entra hoje (bloqueio em hoje+5)',
    exists(select 1 from public.clientes_a_bloquear(hoje + 5) where customer_id = f)
    and not exists(select 1 from public.clientes_a_bloquear(hoje + 4) where customer_id = f), '';

  -- bloqueio automático
  perform public.check_and_block_overdue_customers();
  select block_status into st from public.customers where id = a;
  insert into _resultado values ('bloqueio: A bloqueado', st = 'blocked', st);
  select block_status into st from public.customers where id = b;
  insert into _resultado values ('bloqueio: B continua ativo', st = 'active', st);
  select block_status into st from public.customers where id = c;
  insert into _resultado values ('bloqueio: C (paga) ativo', st = 'active', st);
  select block_status into st from public.customers where id = d;
  insert into _resultado values ('desbloqueio: D pagou e foi liberado', st = 'active', st);
  select block_status into st from public.customers where id = e;
  insert into _resultado values ('bloqueio: E (inativo) não mexe', st = 'active', st);
  insert into _resultado select 'histórico de bloqueio registrado', exists(select 1 from public.block_history where customer_id = a and new_status = 'blocked'), '';
exception when others then
  insert into _resultado values ('erro inesperado', false, sqlerrm);
end $$;

select case when ok then 'ok   ' else 'FALHA' end as resultado, teste, nullif(detalhe, '') detalhe from _resultado;
select count(*) filter (where not ok) as falhas, count(*) as testes from _resultado;

rollback;
