create table public.gastos (
  id uuid primary key default gen_random_uuid(),
  dono uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data date not null default current_date,
  descricao text not null,
  valor numeric(12,2) not null check (valor > 0),
  categoria text not null,
  origem text not null default 'manual' check (origem in ('manual', 'texto', 'foto')),
  criado_em timestamptz not null default now()
);

alter table public.gastos enable row level security;

create policy "ver os meus gastos" on public.gastos for select to authenticated using (dono = (select auth.uid()));
create policy "lançar os meus gastos" on public.gastos for insert to authenticated with check (dono = (select auth.uid()));
create policy "corrigir os meus gastos" on public.gastos for update to authenticated using (dono = (select auth.uid())) with check (dono = (select auth.uid()));
create policy "apagar os meus gastos" on public.gastos for delete to authenticated using (dono = (select auth.uid()));

create index gastos_dono_data on public.gastos (dono, data desc);

create table public.resumos (
  id uuid primary key default gen_random_uuid(),
  dono uuid not null references auth.users (id) on delete cascade,
  semana date not null,
  texto text not null,
  criado_em timestamptz not null default now()
);

alter table public.resumos enable row level security;

create policy "ver os meus resumos" on public.resumos for select to authenticated using (dono = (select auth.uid()));

create index resumos_dono on public.resumos (dono, criado_em desc);

create or replace function public.gerar_resumos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  r record;
begin
  for r in
    with semana as (
      select dono, categoria, valor from public.gastos where data >= current_date - 7
    ), por_categoria as (
      select dono, categoria, sum(valor) as soma,
             row_number() over (partition by dono order by sum(valor) desc) as ordem
        from semana group by dono, categoria
    )
    select s.dono, sum(s.valor) as total, count(*) as lancamentos,
           max(p.categoria) filter (where p.ordem = 1) as maior_categoria,
           max(p.soma) filter (where p.ordem = 1) as maior_valor
      from semana s
      join por_categoria p on p.dono = s.dono and p.categoria = s.categoria
     group by s.dono
  loop
    insert into public.resumos (dono, semana, texto)
    values (r.dono, current_date,
            format('Nos últimos 7 dias: R$ %s em %s %s. A maior categoria foi %s, com R$ %s.',
                   replace(to_char(r.total, 'FM999G999G990D00'), '.', ','),
                   r.lancamentos, case when r.lancamentos = 1 then 'lançamento' else 'lançamentos' end,
                   r.maior_categoria, replace(to_char(r.maior_valor, 'FM999G999G990D00'), '.', ',')));
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.gerar_resumos() from public, anon, authenticated;
