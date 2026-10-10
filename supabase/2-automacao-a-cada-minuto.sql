create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('resumo-da-semana', '* * * * *', 'select public.gerar_resumos()');
