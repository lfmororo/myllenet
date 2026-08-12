ALTER TABLE public.wan_logs 
ADD COLUMN IF NOT EXISTS cpu_load FLOAT8,
ADD COLUMN IF NOT EXISTS free_memory INT8,
ADD COLUMN IF NOT EXISTS total_memory INT8,
ADD COLUMN IF NOT EXISTS temperature FLOAT8;

COMMENT ON COLUMN public.wan_logs.cpu_load IS 'Mikrotik CPU load percentage';
COMMENT ON COLUMN public.wan_logs.free_memory IS 'Mikrotik free memory in bytes';
COMMENT ON COLUMN public.wan_logs.total_memory IS 'Mikrotik total memory in bytes';
COMMENT ON COLUMN public.wan_logs.temperature IS 'Mikrotik temperature in Celsius';