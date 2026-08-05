-- Las fórmulas relacionadas pueden producir centésimas, por ejemplo 40 / 3 = 13.33.
begin;

update public.analysis_versions av
set decimals = 2
from public.analyses a
where a.id = av.analysis_id
  and a.code in ('HEM-RBC', 'HEM-HB', 'HEM-HCT')
  and av.clinical_status = 'approved'
  and av.effective_to is null;

commit;
