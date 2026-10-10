select cron.schedule('resumo-da-semana', '0 11 * * 1', 'select public.gerar_resumos()');
